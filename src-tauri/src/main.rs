// Prep desktop shell.
//
// The window is a thin wrapper: the whole application is the Bun sidecar, which serves the built
// UI and the JSON API from one port. This process spawns it, waits for it to answer, points the
// window at it, and kills it on exit.
//
// Three things are deliberate:
//
// 1. **The port is chosen at runtime, not hardcoded.** A fixed port collides with the Vite dev
//    server (5174) and with the API's own default (5173), and a collision here looks like "the
//    app opens a blank window" with nothing to explain it. The shell asks the OS for a free port
//    by binding and releasing one, then passes it to the sidecar.
//
// 2. **The sidecar's resources are pointed at explicitly.** Under `bun build --compile`,
//    `import.meta.dir` becomes a path inside the executable, so the compiled binary cannot find
//    its migrations, harnesses or UI relative to itself. `PREP_RESOURCES` and `PREP_UI_DIR` are
//    the overrides `src/server/paths.ts` reads, and Tauri's resource directory is where the
//    bundle actually puts them.
//
// 3. **The child is killed on exit.** A sidecar that outlives its window keeps a port bound and
//    leaves an 82 MB process running with no UI to close it from.

use std::net::TcpListener;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The running sidecar, so it can be killed when the window closes.
struct Sidecar(Mutex<Option<CommandChild>>);

/// A free localhost port, by binding port 0 and releasing it.
///
/// There is a window between the release and the sidecar's bind where another process could take
/// it. That window is microseconds and the alternative — a fixed port — fails outright whenever
/// the dev server is already running, which is the common case on the machine this is built on.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("could not find a free port")
}

/// Wait until the sidecar accepts connections, or give up.
///
/// Polling the port rather than parsing stdout: the sidecar prints its banner before the socket
/// is necessarily accepting, and the line format is a thing this shell would then depend on.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Tauri's resource dir is where `bundle.resources` lands the migrations, harnesses and
            // built UI. The sidecar is told to read them from there rather than from beside
            // itself, because a compiled Bun binary cannot resolve paths next to itself.
            let resource_dir = handle
                .path()
                .resource_dir()
                .expect("no resource directory");

            // The database lives in the app's own data directory, not next to the executable:
            // an installer's program-files directory is not writable, and progress belongs with
            // the user's data either way.
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("no app data directory");
            std::fs::create_dir_all(&data_dir).expect("could not create the data directory");
            let db_path = data_dir.join("prep.db");

            let port = free_port();

            let resources = resource_dir.join("resources");
            let ui_dir = resources.join("ui");

            let sidecar = handle
                .shell()
                .sidecar("prep-server")
                .expect("no prep-server sidecar configured")
                .env("PORT", port.to_string())
                .env("PREP_RESOURCES", resources.to_string_lossy().to_string())
                .env("PREP_UI_DIR", ui_dir.to_string_lossy().to_string())
                .env("PREP_DB_PATH", db_path.to_string_lossy().to_string());

            let (mut rx, child) = sidecar.spawn().expect("could not start the server");

            app.state::<Sidecar>().0.lock().replace(child);

            // The sidecar's output is forwarded to this process's stderr, so a startup failure is
            // visible in a terminal when the app is run from one instead of vanishing.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprintln!("[server] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[server] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[server] exited with {:?}", payload.code);
                        }
                        _ => {}
                    }
                }
            });

            // The window is created here rather than in `tauri.conf.json` because its URL is not
            // known until the port is. It starts hidden and is shown once the server answers, so
            // the user never sees a white window flash before the app loads.
            let window = WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .title("Prep")
            .inner_size(1280.0, 860.0)
            .min_inner_size(900.0, 600.0)
            .visible(false)
            .build()?;

            let window_for_thread = window.clone();
            std::thread::spawn(move || {
                let url = format!("http://127.0.0.1:{port}/");
                if wait_for_port(port, Duration::from_secs(30)) {
                    let _ = window_for_thread.navigate(url.parse().unwrap());
                    let _ = window_for_thread.show();
                } else {
                    // A blank window with no explanation is the worst outcome, so say what
                    // happened in the window itself.
                    let _ = window_for_thread.navigate(
                        "data:text/html,<body style='background:%23101215;color:%23e8b84b;font:14px system-ui;padding:40px'>The Prep server did not start. Run <code>bun run build:desktop</code> and rebuild.</body>"
                            .parse()
                            .unwrap(),
                    );
                    let _ = window_for_thread.show();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app_handle, event| {
            // Kill the sidecar on the way out. Without this the server keeps running after the
            // window closes, holding its port and its 82 MB of memory.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<Sidecar>().0.lock().take() {
                    let _ = child.kill();
                }
            }
        });
}
