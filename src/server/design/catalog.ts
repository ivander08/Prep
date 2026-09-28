/**
 * System design prompts — the shared catalogue.
 *
 * One entry per prompt, held in code rather than a table, the same way `concepts/catalog.ts`
 * and `patterns.ts` are: a prose edit is then a source edit, not a migration.
 *
 * THE ANSWER KEY IS HERE AND MUST NOT REACH THE CLIENT. `functional`, `nonFunctional`,
 * `estimates`, `deepDives` and `commonMistakes` are what the interviewer confirms when
 * asked, not a script it reads out. The whole point of the requirements phase is that the
 * candidate asks; a prompt that volunteers its requirements has removed the phase. The
 * endpoint therefore serves only `{slug, title, statement}`.
 *
 * `estimates` carry the working as well as the number, because the estimation phase is
 * graded on whether the candidate can produce a defensible order of magnitude, and an
 * answer key without the arithmetic cannot check that.
 */

export type DesignPrompt = {
  slug: string;
  title: string;
  /** The one-line prompt as an interviewer would say it. */
  statement: string;
  /**
   * Requirements the interviewer will confirm if asked. NOT volunteered — the whole point of
   * the requirements phase is that the candidate asks, so this is the answer key, not a
   * script the interviewer reads out.
   */
  functional: string[];
  nonFunctional: string[];
  /** Reference figures for the estimation phase, used to grade arithmetic. */
  estimates: { label: string; value: string; working: string }[];
  /** Components worth a deep dive, with the probe each invites. */
  deepDives: { component: string; probe: string; strongAnswer: string }[];
  /** Where a candidate typically goes wrong on this prompt. */
  commonMistakes: string[];
  /**
   * The executable component in the Build track that implements part of this design, or
   * null. This is what makes the two halves one exercise rather than two.
   */
  componentSlug: string | null;
};

export const DESIGN_PROMPTS: DesignPrompt[] = [
  {
    slug: "url-shortener",
    title: "URL shortener",
    statement:
      "Design a URL shortener like bit.ly. Users submit a long URL and get a short one back; following the short URL redirects to the original.",
    functional: [
      "Create a short URL from a long one, returning the short code",
      "Redirect a short code to its original URL",
      "Custom aliases, at least for a paid tier",
      "Expiry, either by TTL or by explicit deletion",
      "Click analytics: total clicks, and ideally referrer and geography",
    ],
    nonFunctional: [
      "Redirect latency under ~50 ms at p99, because the user is waiting on a browser navigation",
      "Read-heavy by orders of magnitude — a 1000:1 read:write ratio is the normal shape",
      "Short codes must be unguessable if the link is meant to be private, which rules out pure sequential ids",
      "Availability matters far more than consistency for redirects: a stale mapping is better than a 500",
    ],
    estimates: [
      {
        label: "Write QPS",
        value: "~230 writes/s average, ~700/s at 3x peak",
        working: "100M new URLs/day = 100e6 / 86,400 ≈ 1,157/s. That is a high-end assumption; at 20M/day it is ~230/s. Always state the assumption before the number.",
      },
      {
        label: "Read QPS",
        value: "~230,000 reads/s at a 1000:1 ratio",
        working: "230 writes/s × 1000 = 230,000/s. This is the number that decides the architecture: it is far past what one relational primary serves.",
      },
      {
        label: "Storage over 5 years",
        value: "~1.8 TB of mappings",
        working: "20M/day × 365 × 5 = 3.65e10 rows. At ~500 bytes/row (long URL up to 2 KB, short code, metadata, indexes) that is ~18 TB; at 50 bytes of payload it is ~1.8 TB. The spread IS the answer — say which row size you assumed.",
      },
      {
        label: "Short code space",
        value: "62^7 ≈ 3.5e12 codes",
        working: "Base62 with 7 characters: 62^7 = 3.52e12. At 20M/day that is ~480 years of exhaustion, so 7 characters is the right length — 6 is 5.7e10 and lasts ~7 years, which is uncomfortably close.",
      },
      {
        label: "Cache size",
        value: "~100 GB for the hot 20%",
        working: "If 20% of keys take 80% of traffic and a row is ~500 bytes: 0.2 × 3.65e10 × 500 B ≈ 3.6 TB, which is too much — so cache the last N days instead: 20M × 500 B × 30 days ≈ 300 GB, or shard across 3 nodes.",
      },
    ],
    deepDives: [
      {
        component: "Short-code generation",
        probe: "How do you generate the code, and what happens when two writers collide on the same one?",
        strongAnswer:
          "Two families. A counter encoded in base62 is collision-free and compact but leaks volume and is a single point of coordination; a distributed counter (each node gets a block of 1M ids) fixes the coordination but still leaks volume, so people add a random offset. A hash of the URL (MD5, take 7 chars) needs a collision check and a retry with a salt, which is a read on every write. The strong answer names the tradeoff: counter = no collisions but guessable; random = unguessable but needs a uniqueness check.",
      },
      {
        component: "Redirect path",
        probe: "Walk me through a redirect request, and say where the 50 ms goes.",
        strongAnswer:
          "DNS → CDN edge → service → cache lookup → 301/302. The latency budget is mostly the cache: a hit is sub-millisecond, a miss costs a sharded-index read plus a write-back. The distinction that matters is 301 (permanent, cached by the browser, so analytics are lost) versus 302 (temporary, every click hits you, analytics work). Naming that tradeoff is the signal.",
      },
      {
        component: "Analytics pipeline",
        probe: "The redirect is on the critical path. How do you count clicks without slowing it down?",
        strongAnswer:
          "The redirect must not wait on the analytics write, so it is fire-and-forget into a log or queue (Kafka) and aggregated offline. The honest cost is that counts are eventually consistent — a dashboard lagging by a minute is the price of the latency budget. Anything that writes to the primary synchronously has put a database write inside a 50 ms budget.",
      },
      {
        component: "Storage sharding",
        probe: "Reads are 230k/s. How is the mapping store sharded, and what breaks?",
        strongAnswer:
          "Shard by short code (hash, not range) so reads spread evenly. Range sharding by code is tempting for locality but the codes are random, so it buys nothing and creates hotspots. The thing that breaks is rebalancing: adding a node remaps a fraction of keys, so a fixed-partition scheme (many more partitions than nodes, moved whole) beats modulo hashing. This is the exact problem the consistent-hash component makes executable.",
      },
    ],
    commonMistakes: [
      "Designing the write path first when reads outnumber writes 1000:1",
      "Choosing a sequential counter and never noticing that the codes are enumerable",
      "Writing analytics synchronously inside the redirect",
      "Estimating storage without stating a row size, so the answer spans 10x",
      "Saying 'use a cache' without naming what is cached, for how long, and at what hit rate",
    ],
    componentSlug: "consistent-hash",
  },
  {
    slug: "twitter-feed",
    title: "Twitter / home timeline",
    statement:
      "Design Twitter's home timeline. A user follows others and sees their tweets, newest first.",
    functional: [
      "Post a tweet (text, up to 280 characters, optionally media)",
      "Follow and unfollow a user",
      "Render a home timeline of the people you follow, newest first",
      "Render a user's own profile timeline",
      "Delete a tweet, and handle deletes propagating to already-built timelines",
    ],
    nonFunctional: [
      "Timeline read latency under ~200 ms — it is the most-hit page in the product",
      "Read:write ratio around 100,000:1 (300M users, ~600M tweets/day)",
      "Timeline must be available even if fan-out is lagging; a stale timeline beats a blank one",
      "Eventual consistency for fan-out is acceptable, but a user's OWN tweet must appear in their own timeline immediately",
    ],
    estimates: [
      {
        label: "Tweet write QPS",
        value: "~7,000/s average, ~21,000/s peak",
        working: "600M tweets/day = 6e8 / 86,400 ≈ 6,944/s. Peak at 3x is ~21,000/s.",
      },
      {
        label: "Timeline read QPS",
        value: "~230,000/s",
        working: "If each of 300M daily users opens the app 3 times and each open reads one page: 9e8 reads/day / 86,400 ≈ 10,400/s. Scale by 20 for refreshes and background polling and you are past 200,000/s. State which assumption you used.",
      },
      {
        label: "Storage per year",
        value: "~2 TB of tweet text, before media",
        working: "6e8 tweets/day × 365 = 2.2e11 tweets/year × ~300 bytes (text + ids + metadata) ≈ 66 TB. Text only; media is a separate object store and typically 100x the bytes.",
      },
      {
        label: "Fan-out writes",
        value: "~175M timeline inserts/s at the extreme",
        working: "If the average user has 200 followers, 7,000 tweets/s × 200 = 1.4M inserts/s — 200x the tweet write rate. That multiplier IS the fan-out problem: push is cheap to read and expensive to write.",
      },
      {
        label: "Timeline cache size",
        value: "~150 GB for 800-tweet timelines",
        working: "300M active users × 800 tweet ids × 8 bytes ≈ 1.9 TB of ids alone. Most tools therefore cache only for active users (say 50M) → ~320 GB, sharded across a Redis cluster.",
      },
    ],
    deepDives: [
      {
        component: "Fan-out on write vs read",
        probe: "When a user with 50M followers tweets, what happens?",
        strongAnswer:
          "Push (fan-out on write) precomputes every follower's timeline, so reads are a single cache lookup — but a 50M-follower account makes one tweet a 50M-row write burst. Pull (fan-out on read) merges the timelines of everyone you follow at read time, which is cheap to write and expensive to read. The correct answer is hybrid: push for ordinary accounts, pull for the celebrity accounts, with the read path merging the pulled celebrity tweets into the pushed timeline. Naming the threshold ('above N followers, stop pushing') is the signal.",
      },
      {
        component: "Timeline store",
        probe: "Where does a precomputed timeline actually live, and how big is it?",
        strongAnswer:
          "A Redis sorted set per user, scored by timestamp, trimmed to ~800 entries. The number that matters is total bytes: 300M users × 800 × 8 bytes is ~2 TB, so only active users are cached and cold users are rebuilt on demand from the tweet store. Rebuilding is a fan-out-on-read for one user, which is acceptable because it happens once.",
      },
      {
        component: "Delete propagation",
        probe: "A user deletes a tweet that was fanned out to 200 timelines. Now what?",
        strongAnswer:
          "The honest answer is that you do not rewrite 200 timelines. You tombstone the tweet id and filter at read time, or let the timeline entry point at a tweet that no longer resolves and drop it on render. The tradeoff is a read-time check on every timeline entry versus a write burst on every delete; deletes are rare enough that the read-time check wins. A candidate who says 'I'd delete it from every timeline' has not costed the operation.",
      },
      {
        component: "Media handling",
        probe: "How does an image upload get from a phone to a timeline?",
        strongAnswer:
          "The client asks for a pre-signed upload URL, uploads directly to object storage, and only then posts the tweet with the media key. The tweet write must not carry bytes — putting a 5 MB upload through the tweet service turns a 7,000/s service into a bandwidth problem and makes the write latency unbounded. Transcoding and CDN distribution happen after the ack.",
      },
    ],
    commonMistakes: [
      "Designing pure push fan-out and never noticing the celebrity problem",
      "Treating the timeline as a SQL query ('SELECT ... WHERE user IN (followees) ORDER BY ts')",
      "Ignoring that a user's own tweet must appear immediately even when fan-out lags",
      "Putting media bytes through the tweet write path",
      "Not trimming the cached timeline, so the cache grows without bound",
    ],
    componentSlug: null,
  },
  {
    slug: "chat-slack",
    title: "Chat (Slack)",
    statement:
      "Design a chat application like Slack: users join channels, send messages, and everyone in the channel sees them in order.",
    functional: [
      "Create channels, join and leave them",
      "Send a message to a channel, and to a direct message thread",
      "Deliver messages to online members in real time",
      "Show history when a member opens a channel, paginated backwards",
      "Read receipts and unread counts",
      "File attachments",
    ],
    nonFunctional: [
      "Message delivery under ~100 ms for online users",
      "Strict ordering within a channel — two members must never see the same two messages in different orders",
      "History must be durable: a message ack'd to the sender must never be lost",
      "Reconnect must not lose or duplicate messages",
    ],
    estimates: [
      {
        label: "Concurrent connections",
        value: "~5M persistent WebSocket connections",
        working: "10M daily users, ~50% online at peak = 5M concurrent sockets. At 50k sockets per node that is 100 connection-gateway nodes — the number that decides whether you need a connection registry.",
      },
      {
        label: "Message QPS",
        value: "~12,000/s average",
        working: "1e9 messages/day / 86,400 ≈ 11,600/s. Peak at 3x ≈ 35,000/s.",
      },
      {
        label: "Storage per year",
        value: "~110 TB before attachments",
        working: "1e9/day × 365 = 3.65e11 messages/year × ~300 bytes ≈ 110 TB. Attachments are an object store and typically an order of magnitude more.",
      },
      {
        label: "Fan-out per message",
        value: "~100 deliveries for a 100-member channel",
        working: "12,000 messages/s × 100 members = 1.2M deliveries/s. This is why the delivery path must be a pub/sub broadcast, not a per-recipient database write.",
      },
      {
        label: "Connection memory",
        value: "~500 GB across the gateway fleet",
        working: "5M connections × ~100 KB per socket (buffers, TLS state, session) ≈ 500 GB. That is 100 nodes at 5 GB each, and it is why you cannot keep per-connection state in a single service.",
      },
    ],
    deepDives: [
      {
        component: "Message ordering",
        probe: "Two users send a message to the same channel at the same millisecond. What order do they land in, and who decides?",
        strongAnswer:
          "A single writer per channel — a partition of the log keyed by channel id — assigns the sequence number, so ordering is decided at the log, not at the clients' clocks. Client timestamps cannot order anything, because clocks disagree. The honest consequence is that the sender's 'sent' time may differ from the log's sequence, so the UI shows server order, not local order. Snowflake ids make this concrete and executable.",
      },
      {
        component: "Connection registry",
        probe: "User A sends a message. How do you find the gateway node holding user B's socket?",
        strongAnswer:
          "A presence registry — Redis mapping user_id → node_id, with a TTL heartbeat — because the gateway that holds the socket is not the gateway that received the message. Without it you broadcast to every node and let 99 of them drop the message, which is a real design (and what some systems do) but costs N× the network. The tradeoff is a lookup per message versus a broadcast per message.",
      },
      {
        component: "Delivery guarantee",
        probe: "A user's phone loses signal mid-message. What do they see on reconnect, and what is the mechanism?",
        strongAnswer:
          "The client tracks the last sequence number it has seen per channel and asks for everything after it on reconnect. Delivery is at-least-once with client-side dedup by message id, because exactly-once over a lossy socket is not achievable without an unbounded acknowledgement window. The signal is naming the dedup key, not just saying 'it resends'.",
      },
      {
        component: "History read path",
        probe: "Opening a channel shows the last 50 messages. Where do those come from?",
        strongAnswer:
          "A per-channel log partitioned by channel id, read backwards by sequence, with the newest page served from a cache because it is the one everyone opens. Paginating backwards is a range scan on the partition key, which is cheap; paginating forwards through a channel's entire history is what makes search a separate index. Saying 'query the messages table ordered by time' ignores that the table has 3.65e11 rows a year.",
      },
    ],
    commonMistakes: [
      "Ordering messages by client timestamp",
      "Delivering by writing a row per recipient, so a 100-member channel is 100 writes",
      "Forgetting the presence registry, so the fan-out is a fleet-wide broadcast",
      "Assuming exactly-once delivery over a socket",
      "Treating attachments as part of the message write",
    ],
    componentSlug: "snowflake-id",
  },
  {
    slug: "youtube",
    title: "YouTube",
    statement: "Design YouTube: upload a video, and let anyone watch it.",
    functional: [
      "Upload a video and make it watchable",
      "Stream it back for playback at multiple resolutions",
      "Search videos by title and description",
      "View count, likes, comments",
      "Recommendations on the home page",
    ],
    nonFunctional: [
      "Playback must start within ~1-2 s, and must not stall mid-stream",
      "Storage is dominated by bytes, not rows — this is a blob problem with a metadata problem attached",
      "Uploads can be multi-gigabyte, so the upload path must be resumable",
      "Watching is 1000x more frequent than uploading; the read path is what is optimised",
    ],
    estimates: [
      {
        label: "Upload volume",
        value: "~1 PB/day",
        working: "500 hours of video uploaded per minute = 720,000 hours/day. At ~5 Mbps average ≈ 2.25 GB/hour → 720,000 × 2.25 GB ≈ 1.6 PB/day of source. State the bitrate assumption.",
      },
      {
        label: "Transcoded storage multiplier",
        value: "~3-5x the source bytes",
        working: "One source becomes 240p/360p/480p/720p/1080p/1440p/4K. The low renditions are small and the high ones are near source size, so the sum is roughly 3-5x. This is the number candidates forget, and it multiplies the storage answer.",
      },
      {
        label: "Watch QPS",
        value: "~1-5 million concurrent streams",
        working: "2B daily users × 30 min/day ≈ 1e9 hours/day. Concurrent = 1e9 hours/day / 24 h ≈ 4e7 stream-hours per hour — i.e. ~40M concurrent if a 'stream' is one viewer. Realistically lower after CDN absorption, but the point is that origin servers never see this.",
      },
      {
        label: "CDN egress",
        value: "~90%+ served from edge",
        working: "At 5 Mbps per stream and 5M concurrent, origin egress would be 25 Tbps. That number is why the CDN is the design: an origin that serves 25 Tbps is not a thing you can buy.",
      },
      {
        label: "Metadata rows",
        value: "~1e9 video rows, ~1 TB",
        working: "1e9 videos × ~1 KB of metadata (title, description, ids, counters) ≈ 1 TB. That fits on a handful of shards, which is why the metadata store is not the hard part — the bytes are.",
      },
    ],
    deepDives: [
      {
        component: "Upload and transcoding pipeline",
        probe: "A 4 GB upload arrives. Walk me through it to the point where it is watchable.",
        strongAnswer:
          "Client uploads directly to object storage via pre-signed multipart URLs (resumable, and the API service never touches the bytes). On completion the storage emits an event that enqueues a transcode job. The transcoder segments the video, emits DASH/HLS renditions per resolution, writes them back to storage, and only then flips the video's status to 'available'. The signal is that the video is not watchable until transcoding completes, and that the status flag is the handoff point.",
      },
      {
        component: "Playback and CDN",
        probe: "Why is playback not served from your origin?",
        strongAnswer:
          "Because of the egress number: millions of concurrent streams at several Mbps is tens of Tbps, which no origin fleet can serve. The CDN caches segments at the edge, keyed by (video id, rendition, segment index), and origin egress drops by ~90%+. The tradeoff is cache invalidation for a re-upload and the cost of edge storage for a long tail of unwatched videos.",
      },
      {
        component: "Adaptive bitrate",
        probe: "How does the player decide which rendition to fetch next?",
        strongAnswer:
          "The video is chopped into ~4 s segments, and the player picks the next segment's rendition from measured throughput and buffer level. This is why transcoding must produce the full ladder up front — the player cannot ask for a rendition that does not exist. Naming the segment length and the buffer target is the depth signal; 'it streams in 720p' is not an answer.",
      },
      {
        component: "View counting",
        probe: "A video has 1 billion views. How is that counter maintained?",
        strongAnswer:
          "Never one row incremented per view — that is a single-row hotspot at millions of writes/s. The real design is an event stream into an aggregation job that writes batched deltas, with the displayed count read from a cache. The honest tradeoff is that the count is eventually consistent and may be approximate, which is fine because nobody's experience depends on the exact number.",
      },
    ],
    commonMistakes: [
      "Streaming bytes through the API service instead of direct-to-storage",
      "Forgetting the transcoded storage multiplier (3-5x source)",
      "Serving playback from origin instead of a CDN",
      "Incrementing a view counter row per view",
      "Making the video watchable before transcoding finishes",
    ],
    componentSlug: null,
  },
  {
    slug: "google-drive",
    title: "Google Drive",
    statement:
      "Design Google Drive: store a user's files, sync them across their devices, and let them share files with other users.",
    functional: [
      "Upload, download, rename, move and delete files and folders",
      "Sync across a user's devices: an edit on one appears on the others",
      "Share a file with another user, with read or write permission",
      "Version history and restore",
      "Search by filename and content",
    ],
    nonFunctional: [
      "A file must never be silently corrupted or lost — durability is the top constraint",
      "Sync latency of a few seconds is acceptable; conflict-free behaviour is not optional",
      "Bandwidth must not be proportional to file size for small edits — a 1-byte change in a 1 GB file cannot re-upload 1 GB",
      "Storage is blob-dominated, but the metadata must be strongly consistent because a lost directory entry orphans data",
    ],
    estimates: [
      {
        label: "Storage",
        value: "~1 EB total, ~15 GB per user average",
        working: "1B users × 15 GB ≈ 15 EB of nominal quota, but the average actual usage is far lower — say 100 GB total per active user at 10% active → ~1.5 EB. The gap between quota and usage is worth naming.",
      },
      {
        label: "Upload QPS",
        value: "~12,000/s",
        working: "If 10% of 1B users upload one file a day: 1e8 / 86,400 ≈ 1,157/s. At 10 files/day it is ~12,000/s. Files per user per day is the assumption that moves this by an order of magnitude.",
      },
      {
        label: "Sync notification volume",
        value: "~1M notifications/s at peak",
        working: "Each change notifies every device of that user (say 3) and every collaborator (say 2) = 5 notifications. 12,000 uploads/s × 5 = 60,000/s, and a burst after a popular share can be far higher.",
      },
      {
        label: "Chunk size",
        value: "4 MB",
        working: "A 1 GB file is 256 chunks. Small enough that a 1-byte edit re-uploads 4 MB rather than 1 GB; large enough that a 1 GB file is 256 requests rather than 1,000,000. This is the single number that answers the bandwidth constraint.",
      },
      {
        label: "Metadata rows",
        value: "~1e11 rows, tens of TB",
        working: "1B users × 100 files = 1e11 file rows × ~1 KB (name, path, owner, hash, version refs) ≈ 100 TB. That does not fit on one primary, so it is sharded by user — and sharding by user is also what makes the sharing case hard.",
      },
    ],
    deepDives: [
      {
        component: "Chunking and dedup",
        probe: "A user edits one byte in the middle of a 1 GB file. What actually gets uploaded?",
        strongAnswer:
          "The file is chunked (content-defined chunking, not fixed-size, so an insertion does not shift every boundary), each chunk is hashed, and only changed chunks are uploaded. The server dedups by chunk hash, so the same chunk across users costs one copy. The tradeoff is that dedup by hash requires a hash-to-reference index and, if you dedup across users, a way to handle reference counting on delete.",
      },
      {
        component: "Sync protocol",
        probe: "How does a device learn that a file changed, and how do you avoid sending it the whole tree?",
        strongAnswer:
          "A per-user change log with a monotonic cursor: the device stores the last cursor it processed and asks for changes since then. Sending the whole tree on every poll is O(files) per poll per device. The cursor is also what makes reconnect cheap — the device does not need to diff, it just replays. The hard part is that the log must be durable and ordered per user, which is why the metadata store is not eventually consistent.",
      },
      {
        component: "Conflict resolution",
        probe: "Two devices edit the same file offline. Both come online. What happens?",
        strongAnswer:
          "Per-chunk last-writer-wins is the practical answer for binary files: the later chunk wins and the loser's chunk is preserved as a conflict copy so nothing is lost. Operational-transform or CRDT merge is the right answer for structured documents, not for arbitrary bytes. The signal is knowing that you cannot merge a JPEG and that the correct behaviour is to keep both rather than pick one silently.",
      },
      {
        component: "Sharing and permissions",
        probe: "How does a permission check work when the file lives on a shard keyed by the owner?",
        strongAnswer:
          "The permission entry is itself a row (file_id, grantee, role) stored with the file, and the sharing path writes a second index row keyed by grantee so 'files shared with me' is one lookup rather than a scan. The tradeoff is that a permission revoke must invalidate both directions, and a cache of permissions must be invalidated on revoke — a stale permission cache is a security bug, not a performance one.",
      },
    ],
    commonMistakes: [
      "Re-uploading whole files for small edits",
      "Making the sync protocol send the whole tree per poll",
      "Using fixed-size chunking, so an insertion shifts every boundary",
      "Merging binary files automatically instead of keeping both",
      "An eventually consistent metadata store, which loses directory entries",
    ],
    componentSlug: null,
  },
  {
    slug: "uber",
    title: "Uber",
    statement:
      "Design Uber: a rider requests a trip, the system matches them with a nearby driver, and both track the trip until it ends.",
    functional: [
      "Rider requests a ride and gets a price estimate",
      "Match the rider with a nearby available driver",
      "Both sides see each other's live location during the trip",
      "Compute the fare and take payment at the end",
      "Driver location updates while online",
      "Trip history for both sides",
    ],
    nonFunctional: [
      "Matching latency under a few seconds, because the rider is standing on a street",
      "Location updates arrive at very high frequency — every few seconds per active driver",
      "The system must be geo-partitioned: a rider in Jakarta and a driver in Jakarta never need to consult a server in another region",
      "The matching decision must be strongly consistent within a city, or the same driver is offered two trips",
    ],
    estimates: [
      {
        label: "Concurrent drivers",
        value: "~1M globally, ~10k in a large city",
        working: "5M drivers globally, ~20% online at peak = 1M. Per city, 1M / 500 cities ≈ 2,000 average with large cities an order of magnitude above that.",
      },
      {
        label: "Location update QPS",
        value: "~200,000/s globally",
        working: "1M drivers × one update every 5 s = 200,000/s. Every 2 s and it is 500,000/s. This single rate is why locations live in memory, not in a database.",
      },
      {
        label: "Trip QPS",
        value: "~350/s globally",
        working: "20M trips/day / 86,400 ≈ 231/s, ~700/s at 3x peak. Tiny compared with location traffic — a useful contrast to name, because it shows which path deserves the engineering.",
      },
      {
        label: "Geospatial index size",
        value: "~10k live entries per city",
        working: "Only online drivers are indexed. 10k drivers × ~50 bytes (id, cell, last update) = 500 KB per city, which fits in memory on one node per city. That is what makes a per-city in-memory index viable.",
      },
      {
        label: "Storage per year",
        value: "~7 TB of trip rows, plus location history",
        working: "20M trips/day × 365 = 7.3e9 trips × ~1 KB ≈ 7 TB. Location history at 200,000/s × 86,400 × 365 × 50 bytes ≈ 300 TB/year — which is why raw locations are downsampled or expired, not kept forever.",
      },
    ],
    deepDives: [
      {
        component: "Geospatial indexing",
        probe: "How do you find drivers near a rider without scanning every driver?",
        strongAnswer:
          "A grid (S2/geohash) or an R-tree over the city, so a query is the rider's cell plus neighbours. The tradeoff is cell size: too big and one cell holds thousands of drivers to filter; too small and the nearest driver is in a neighbour cell you have to fan out to. Uber's own answer is a hybrid of grid and quadtree with dynamically split cells. Saying 'use a geohash with the right precision and query the 8 neighbours' is the depth signal.",
      },
      {
        component: "Location ingestion",
        probe: "A million drivers each send a location every 5 seconds. Where does that go?",
        strongAnswer:
          "Into an in-memory store keyed by driver (Redis or a custom service), with a TTL so an offline driver's entry expires rather than being explicitly deleted. The database write is asynchronous and batched — putting 200,000 writes/s through a relational store is the mistake. The tradeoff is that a store crash loses recent locations, which is acceptable because the next update arrives in 5 seconds.",
      },
      {
        component: "Matching and consistency",
        probe: "Two riders request a ride at the same moment and the same driver is the nearest to both. What prevents a double-assignment?",
        strongAnswer:
          "The assignment must be an atomic compare-and-set on the driver's state (available → reserved) in one place per city, not a read-then-write. A distributed lock, or a single-threaded matching service per city, both work; the thing that does not work is two nodes reading 'available' and both writing 'assigned'. The signal is naming the atomic operation rather than saying 'we'd handle the race'.",
      },
      {
        component: "Live tracking",
        probe: "How does the rider see the driver's location move?",
        strongAnswer:
          "The rider's client subscribes to the driver's location stream over a socket, and the server pushes at a throttled rate (say 1/s) rather than forwarding every driver update. Pushing all 200,000 updates/s to clients is bandwidth and battery abuse; the client does not need better than once per second. The tradeoff is a slightly stale marker versus a phone that dies in two hours.",
      },
    ],
    commonMistakes: [
      "Storing live locations in a relational database",
      "A global index instead of a per-city partition, so every match crosses regions",
      "Read-then-write assignment without an atomic claim, so two riders get the same driver",
      "Forwarding every location update to every watching client",
      "Keeping raw location history forever instead of downsampling",
    ],
    componentSlug: null,
  },
  {
    slug: "web-crawler",
    title: "Web crawler",
    statement:
      "Design a web crawler that downloads a large portion of the public web and keeps it fresh.",
    functional: [
      "Start from seed URLs and discover new ones by following links",
      "Download pages, respecting robots.txt and crawl-delay",
      "Extract links and enqueue newly discovered URLs",
      "Store page content for later indexing",
      "Re-crawl pages periodically so the index does not go stale",
    ],
    nonFunctional: [
      "Must not overwhelm any single host — politeness is a hard constraint, not a nicety",
      "Must not get stuck in crawler traps (infinite calendars, session-id loops)",
      "Must tolerate hosts that are slow, broken, or hostile",
      "Duplicate content must be detected, because the same page is reachable by many URLs",
    ],
    estimates: [
      {
        label: "Pages to crawl",
        value: "~1e9 pages for a meaningful subset, ~1e11 for the whole web",
        working: "State which. 1e9 pages is a defensible single-crawler target; the whole public web is ~1e11 and is a different problem.",
      },
      {
        label: "Throughput",
        value: "~10,000 pages/s to finish 1e9 pages in ~28 hours",
        working: "1e9 / (10,000 × 86,400) ≈ 1.16 days. At 1,000/s it is 11.6 days. The throughput number IS the schedule, so state which one you are designing for.",
      },
      {
        label: "Storage",
        value: "~500 TB for 1e9 pages at 500 KB",
        working: "1e9 × 500 KB = 5e14 bytes = 500 TB raw. Compressed HTML (gzip ~5x) brings it to ~100 TB, plus the link graph.",
      },
      {
        label: "Politeness budget",
        value: "~1 request per host per second",
        working: "If a host allows 1 req/s, and you want 10,000 pages/s total, you need at least 10,000 hosts in flight at any moment. That is the real constraint: throughput is bounded by the number of distinct hosts, not by your bandwidth.",
      },
      {
        label: "DNS lookups",
        value: "~10,000/s, heavily cacheable",
        working: "One lookup per page worst case, but a local DNS cache with a TTL turns it into roughly one lookup per host per TTL. Without the cache, DNS becomes the bottleneck before the network does.",
      },
    ],
    deepDives: [
      {
        component: "Frontier and politeness",
        probe: "You have 1e9 URLs queued. How do you decide what to fetch next without hammering one host?",
        strongAnswer:
          "The frontier is partitioned by host, and a per-host queue with a next-allowed-time gate is what enforces politeness. The scheduler picks hosts that are ready, not URLs — so a host with 100,000 pending URLs still gets one request per second. The tradeoff is that a host-ordered frontier can starve: a small host with one URL waits behind a queue of big hosts unless you interleave by priority or by a fairness rule.",
      },
      {
        component: "Deduplication",
        probe: "The same article is reachable at five URLs. How do you know it is one page?",
        strongAnswer:
          "URL-level canonicalisation first (strip tracking params, sort query params, normalise case, drop fragments, resolve redirects), then content-level hashing (a simhash or minhash over the text, because the pages differ by an ad banner). Exact-hash-only dedup misses the near-duplicates that dominate the real web. The tradeoff is that a near-duplicate threshold that is too loose merges genuinely different pages.",
      },
      {
        component: "Crawler traps",
        probe: "A site generates infinite URLs from a calendar. How do you not crawl it forever?",
        strongAnswer:
          "Bound the depth per host, cap URLs per host, and detect traps by URL pattern (a repeating path component, an unbounded query parameter) or by measuring discovery rate per host. The signal is treating the frontier as having a per-host budget rather than being an unbounded queue — a crawler with no per-host cap will spend its entire budget on one trap.",
      },
      {
        component: "Re-crawl scheduling",
        probe: "Which of 1e9 pages do you re-crawl first?",
        strongAnswer:
          "By estimated change frequency: a news homepage changes hourly, a static doc changes yearly. Estimate it from observed changes over previous crawls (the standard approach is an exponential change-rate estimate per page) and schedule the next visit from it. Re-crawling everything on a fixed period is the naive answer and wastes most of the budget on pages that never change.",
      },
    ],
    commonMistakes: [
      "A single global URL queue with no per-host gate, so one host gets hammered",
      "Exact content hashing only, which misses near-duplicates",
      "No per-host URL or depth cap, so a trap consumes the whole budget",
      "Re-crawling on a fixed period regardless of change rate",
      "Ignoring robots.txt or crawl-delay",
    ],
    componentSlug: "bloom-filter",
  },
  {
    slug: "notification-system",
    title: "Notification system",
    statement:
      "Design a notification system: a service can ask it to notify a user, and the user gets it by push, email, or SMS.",
    functional: [
      "Accept a notification request from an internal service",
      "Deliver by push, email, or SMS depending on user preference",
      "Template rendering with per-user variables",
      "User opt-out per channel and per category",
      "Delivery status tracking and retry",
      "Rate limiting so one user cannot be spammed",
    ],
    nonFunctional: [
      "The requesting service must not wait on delivery — the call must return immediately",
      "Delivery must be at-least-once, with dedup so a retry does not send twice",
      "A third-party provider outage must not lose notifications",
      "A notification that arrives 30 minutes late is often worse than one that never arrives — there is a staleness deadline",
    ],
    estimates: [
      {
        label: "Notification QPS",
        value: "~1,000/s average, ~5,000/s peak",
        working: "50M notifications/day / 86,400 ≈ 580/s. Marketing campaigns and a traffic spike push this to 5,000/s or far higher in a burst — the burst is what the queue absorbs.",
      },
      {
        label: "Fan-out to providers",
        value: "~5,000 external calls/s at peak",
        working: "One notification is one provider call (APNs, SES, Twilio). At 5,000/s you are rate-limited by each provider's quota, so the design needs per-provider queues with independent throttles.",
      },
      {
        label: "Retry amplification",
        value: "~3x on a provider outage",
        working: "A 30% provider failure rate with 3 retries means 1.9x the original calls, and a full outage means 3x queued. This is why retries need exponential backoff and a dead-letter queue, not a tight loop.",
      },
      {
        label: "Storage",
        value: "~50 GB/year of notification records",
        working: "50M/day × 365 × ~30 bytes (id, user, channel, status, timestamp) ≈ 550 GB. Small — the log is the record, and the bodies are not stored with it.",
      },
      {
        label: "Dedup window",
        value: "~24 hours",
        working: "A dedup key of (user, template, entity_id) held for 24 h in Redis: 50M keys × ~100 bytes = 5 GB. Cheap, and it is the only thing standing between a retry and a duplicate push.",
      },
    ],
    deepDives: [
      {
        component: "Decoupling from callers",
        probe: "A service calls you to send a notification. What happens synchronously?",
        strongAnswer:
          "Validate, persist, enqueue, return an id. Nothing else. Rendering the template, choosing the channel, and calling APNs all happen asynchronously, because the caller's latency budget is its own and a provider outage must not turn into a caller outage. The signal is that the ack means 'durably accepted', not 'delivered'.",
      },
      {
        component: "Channel routing and preferences",
        probe: "How does a notification end up on push rather than email?",
        strongAnswer:
          "A preference lookup (user × category × channel) resolved at delivery time, with a fallback ladder: try push, and if the user has no live device token, fall back to email. The tradeoff is that preference reads are on the hot path for every notification, so they are cached — and a cache means an opt-out can lag, which for marketing is a compliance problem. Naming that is the depth signal.",
      },
      {
        component: "Retries and idempotency",
        probe: "The push provider times out. You do not know whether it sent. What now?",
        strongAnswer:
          "Retry with the same idempotency key, and rely on the provider (or your own dedup layer) to drop the duplicate. The honest position is that you cannot distinguish 'sent but the ack was lost' from 'never sent', so you choose at-least-once plus dedup over at-most-once plus silent loss. The dedup key is (user, template, entity_id) with a TTL, not the request id — because the retry has a new request id.",
      },
      {
        component: "Rate limiting and batching",
        probe: "A user follows 50 people and all 50 post in a minute. Do they get 50 pushes?",
        strongAnswer:
          "No — there is a per-user rate limit and a coalescing window. The aggregator holds notifications for a short window and merges them into one ('50 new posts'). This is a product decision expressed as a technical one, and the mechanism is a per-user token bucket with a merge buffer. This is the exact component the Build track makes executable.",
      },
    ],
    commonMistakes: [
      "Delivering synchronously in the caller's request",
      "Retrying with a fresh idempotency key, so a retry is a duplicate",
      "A preference cache with no invalidation, so opt-outs lag",
      "No per-user rate limit, so a burst becomes a push storm",
      "Treating all notifications as equally time-sensitive",
    ],
    componentSlug: "token-bucket",
  },
  {
    slug: "rate-limiter",
    title: "Distributed rate limiter",
    statement:
      "Design a rate limiter that protects an API. It runs in front of every request, across many gateway nodes, and enforces per-client limits.",
    functional: [
      "Limit requests per client per time window",
      "Enforce across all gateway nodes, not per node",
      "Return the standard headers (remaining, reset) and a 429 when exceeded",
      "Support different limits per tier and per endpoint",
      "Allow the limit to be changed without a deploy",
    ],
    nonFunctional: [
      "The check must add under ~1 ms — it is on every request",
      "It must fail open or fail closed deliberately, and the choice must be stated",
      "The shared counter store is a single point of contention and must not become the bottleneck",
      "Slight over-admission under a race is usually acceptable; unbounded over-admission is not",
    ],
    estimates: [
      {
        label: "Check QPS",
        value: "~500,000/s",
        working: "Every API request costs one check. If the API does 500,000 req/s, so does the limiter. This is the number that rules out a per-request database write.",
      },
      {
        label: "Counter storage",
        value: "~10 GB for 100M active keys",
        working: "100M clients × ~100 bytes per counter entry = 10 GB. That fits in a Redis cluster, which is what makes a shared counter feasible.",
      },
      {
        label: "Latency budget",
        value: "~1 ms for a Redis round trip",
        working: "A same-datacenter Redis call is ~0.5-1 ms. That is already the whole budget, which is why batching and local pre-checks matter — and why a cross-region counter is not an option.",
      },
      {
        label: "Race window",
        value: "~1 request per node under contention",
        working: "A read-modify-write without atomicity admits one extra request per concurrent node. With 100 nodes that is up to 100 extra per window, which is why the increment must be atomic (INCR or a Lua script).",
      },
      {
        label: "Token bucket state",
        value: "~40 bytes per key",
        working: "tokens (double) + last_refill (timestamp) + config id ≈ 40 bytes. Smaller than a window counter with per-request timestamps, which is one reason the token bucket is preferred.",
      },
    ],
    deepDives: [
      {
        component: "Algorithm choice",
        probe: "Compare fixed window, sliding window log, sliding window counter, and token bucket for this API.",
        strongAnswer:
          "Fixed window is one INCR and a TTL but admits 2x the limit across a boundary. Sliding window log is exact but stores a timestamp per request, which is O(requests) memory. Sliding window counter interpolates the previous window's count and is a good accuracy/memory trade. Token bucket allows bursts up to the bucket size and refills continuously, which matches most APIs' real semantics. The signal is naming the boundary-burst flaw of fixed window unprompted.",
      },
      {
        component: "Distributed counting",
        probe: "How do you keep one counter across 100 gateway nodes without making Redis the bottleneck?",
        strongAnswer:
          "Atomic increment in Redis (INCR or a Lua script for the refill), plus local pre-checks so a client that has already blown its budget is rejected without a round trip. If Redis itself saturates, shard the counters by client id and accept that a client spanning shards is approximated. The tradeoff is accuracy versus throughput, and the honest answer states which one is being given up.",
      },
      {
        component: "Failure behaviour",
        probe: "The counter store is down. Do you admit or reject traffic?",
        strongAnswer:
          "Fail open for a rate limiter that exists to protect your own backend from overload is arguably wrong — the whole point is protection. Most systems fail open because a rate limiter outage taking down the entire API is worse than a temporary overload, and they add a local fallback limiter so the protection is degraded rather than absent. Either choice is defensible; not having decided is not.",
      },
      {
        component: "Configuration distribution",
        probe: "You change a client's limit. How does every node learn within seconds?",
        strongAnswer:
          "Config is pushed to a local cache on each node via a pub/sub or a short-TTL poll, and the check reads the local copy. A config read per request is a second round trip per request and doubles the latency budget. The tradeoff is that a limit change takes up to the poll interval to take effect everywhere, which for a security-motivated limit may be too slow.",
      },
    ],
    commonMistakes: [
      "A per-node in-memory counter, so the effective limit is limit × nodes",
      "Read-modify-write instead of an atomic increment",
      "A per-request database write",
      "Fixed window with no awareness of the 2x boundary burst",
      "No stated fail-open/fail-closed decision",
    ],
    componentSlug: "token-bucket",
  },
  {
    slug: "news-feed",
    title: "News feed ranking",
    statement:
      "Design the ranking layer of a social news feed: given a user and a pool of recent posts, decide what to show and in what order.",
    functional: [
      "Retrieve candidate posts for a user",
      "Score each candidate by predicted engagement",
      "Order by score, with diversity and freshness adjustments",
      "Serve the first page fast and page deeper on scroll",
      "Accept feedback (click, like, hide) and use it",
    ],
    nonFunctional: [
      "The first page must be served in under ~200 ms, including the ranking",
      "Ranking must be stable enough that a refresh does not reorder everything",
      "The model must be retrainable without a deploy of the serving path",
      "A candidate pool of thousands must be reduced to tens within the latency budget",
    ],
    estimates: [
      {
        label: "Candidate pool",
        value: "~1,000-10,000 posts per user",
        working: "Everyone you follow × their recent posts, plus recommended content. The pool size is what decides whether you can score everything or must retrieve-then-rank.",
      },
      {
        label: "Feature computation",
        value: "~200 features per candidate",
        working: "10,000 candidates × 200 features = 2M feature lookups per request. At 1 ms per lookup that is 2,000 s, which is why features are precomputed and the candidate set is pruned before scoring.",
      },
      {
        label: "Serving QPS",
        value: "~50,000/s",
        working: "If 500M daily users each open the feed 10 times: 5e9 / 86,400 ≈ 58,000/s. State the opens-per-user assumption.",
      },
      {
        label: "Latency budget split",
        value: "~50 ms retrieval, ~100 ms scoring, ~50 ms post-processing",
        working: "The budget must be allocated before the design, because it decides how many candidates can be scored. A model with a 10 ms per-candidate cost cannot score 10,000 candidates in 100 ms.",
      },
      {
        label: "Model size",
        value: "~100 MB",
        working: "A small ranker (logistic regression or a shallow GBDT) loads in tens of MB and scores in microseconds; a deep model is 100 MB+ and needs a GPU or a batched vectorised path. The size decides the serving architecture.",
      },
    ],
    deepDives: [
      {
        component: "Retrieval vs ranking",
        probe: "Why not just score every post from everyone the user follows?",
        strongAnswer:
          "Because the cost is candidates × features, and at 10,000 candidates it does not fit the budget. So there is a cheap retrieval stage (follow graph, recent activity, embedding similarity, trending) that cuts to a few hundred, then an expensive ranking stage. This two-stage shape is the single most important structural answer on this prompt.",
      },
      {
        component: "Feature freshness",
        probe: "How fresh does a feature like 'post likes' need to be?",
        strongAnswer:
          "It depends on the feature: post-level counters can be minutes stale without hurting ranking, but 'has the user seen this' must be exact or the feed repeats itself. The mechanism is a fast store for the exactness-critical features and a batch-computed store for the rest. Naming which features can be stale, rather than treating freshness as uniform, is the signal.",
      },
      {
        component: "Diversity and stability",
        probe: "The top 20 are all from one account. What do you do, and how do you avoid reordering on refresh?",
        strongAnswer:
          "Post-processing applies a diversity penalty (per-author and per-topic caps) after scoring, which is a ranking-time constraint rather than a model change. Stability comes from a per-session seed so the same candidate pool scores the same way across a refresh, with new posts inserted rather than a full re-sort. The tradeoff is that a deterministic seed can hide a genuinely better post that arrived after the first page.",
      },
      {
        component: "Training and feedback loop",
        probe: "The model needs to learn from clicks. How does a click become a training example?",
        strongAnswer:
          "Impression logging — every served item with its position and the features used — joined against the click event, then trained offline on the joined log and shipped as a new model artifact the serving path loads without a deploy. The hard part is that only shown items have feedback, so the training data is biased by the current model's choices (position bias), and the standard fix is to include position as a feature or to correct with inverse propensity weights. Naming position bias is a strong signal.",
      },
    ],
    commonMistakes: [
      "Scoring every candidate in the full pool",
      "Treating feature freshness as uniform",
      "No diversity constraint, so one author dominates",
      "Re-sorting on every refresh, so scrolling is unstable",
      "Training on clicks without correcting for position bias",
    ],
    componentSlug: "inverted-index",
  },
  {
    slug: "search-autocomplete",
    title: "Search autocomplete",
    statement:
      "Design search autocomplete: as a user types, show the top suggestions for the prefix within a keystroke or two.",
    functional: [
      "Return the top N completions for a prefix",
      "Rank by popularity, personalised where possible",
      "Update the ranking from recent queries",
      "Handle typos and near-prefixes",
      "Filter offensive suggestions",
    ],
    nonFunctional: [
      "Latency under ~100 ms end to end, because it fires on every keystroke",
      "Must tolerate a query burst — a trending event multiplies traffic instantly",
      "Ranking updates may lag by minutes; a suggestion that is one refresh old is fine",
      "The index must fit in memory, or the lookup is a disk seek per keystroke",
    ],
    estimates: [
      {
        label: "Query QPS",
        value: "~100,000/s",
        working: "1e9 searches/day × 10 keystrokes per search = 1e10 prefix queries/day / 86,400 ≈ 115,000/s. The keystroke multiplier is the number people forget.",
      },
      {
        label: "Index size",
        value: "~10 GB for 100M distinct prefixes",
        working: "100M prefixes × ~100 bytes (prefix + top 10 suggestions with scores) = 10 GB. That fits in RAM on a few nodes, which is what makes the in-memory trie viable.",
      },
      {
        label: "Top-K per node",
        value: "~10 suggestions",
        working: "Each trie node stores its top 10 completions precomputed. Storing the full subtree under every node would be O(total queries × depth) — the precomputed top-K is what makes it a single lookup.",
      },
      {
        label: "Update rate",
        value: "~1,000/s of new query counts",
        working: "1e9 searches/day / 86,400 ≈ 11,600/s of raw queries aggregated into counts. Aggregation is batched, so the index rebuild runs on a schedule rather than per query.",
      },
      {
        label: "Cache hit rate",
        value: "~80%+",
        working: "Prefix queries are extremely Zipfian — 'a', 'ab', 'the' dominate. A cache in front of the trie absorbs most traffic, which is why the trie does not need to scale to the raw QPS.",
      },
    ],
    deepDives: [
      {
        component: "Index structure",
        probe: "What data structure serves a prefix lookup, and what is stored at each node?",
        strongAnswer:
          "A trie (or a ternary search tree / a sorted-array-with-binary-search, which is what many production systems actually use for cache friendliness), where each node stores its top-K completions with scores so a lookup is one traversal and one read. The tradeoff is update cost: precomputed top-K at every node means a popularity change requires rebuilding the affected subtree, which is why updates are batched.",
      },
      {
        component: "Ranking and personalisation",
        probe: "How do you rank 'restaurants' differently for two users?",
        strongAnswer:
          "A global popularity score from aggregated query counts, plus a personalised re-rank from the user's history at the top of the list only. Personalising the whole trie per user is impossible (the index would be per-user), so personalisation happens after retrieval on the top ~50 candidates. The tradeoff is that the personalisation signal only sees what the global ranking surfaced.",
      },
      {
        component: "Index refresh",
        probe: "A celebrity dies and everyone searches their name. How fast does that appear, and how do you do it without rebuilding everything?",
        strongAnswer:
          "A real-time overlay: the trie is rebuilt periodically in the background, and a small in-memory trending structure is merged at query time. Rebuilding a 10 GB trie per event is not viable. The tradeoff is a merge step on the hot path, which is why the overlay is kept tiny and cached.",
      },
      {
        component: "Typo tolerance",
        probe: "The user types 'restarant'. What do you return?",
        strongAnswer:
          "A fuzzy match — edit distance within a bound, or a deletion-neighbourhood (SymSpell-style) index that precomputes all strings within one deletion so the lookup is a hash rather than a search. SymSpell's insight is that generating all deletions up front turns fuzzy matching from a search into a lookup, at the cost of index size. The tradeoff is memory for latency.",
      },
    ],
    commonMistakes: [
      "A database LIKE 'prefix%' query per keystroke",
      "No caching, despite the traffic being extremely Zipfian",
      "Personalising the entire index per user",
      "Rebuilding the trie synchronously on every query",
      "Storing the whole subtree at each trie node instead of top-K",
    ],
    componentSlug: "inverted-index",
  },
  {
    slug: "ticketmaster",
    title: "Ticketmaster",
    statement:
      "Design Ticketmaster: many users try to buy the same limited seats at once, and a seat must not be sold twice.",
    functional: [
      "Browse events and see available seats",
      "Hold a seat while the user pays",
      "Complete the purchase, or release the hold on timeout",
      "Prevent two users buying the same seat",
      "Handle a high-demand on-sale where 1M users hit 10,000 seats",
    ],
    nonFunctional: [
      "A seat must never be sold twice — this is the strongest consistency requirement in the prompt",
      "The browse path can be stale; the purchase path cannot",
      "Holds must expire automatically, or inventory leaks",
      "The system must survive a thundering herd at the on-sale instant",
    ],
    estimates: [
      {
        label: "On-sale burst",
        value: "~1M users in the first minute, ~17,000/s",
        working: "1e6 / 60 ≈ 16,700/s. Against 10,000 seats, the ratio is 100:1 — which is why a virtual waiting room exists at all.",
      },
      {
        label: "Purchase throughput",
        value: "~50/s for a 10,000-seat show",
        working: "10,000 seats sold over ~200 s = 50/s. The bottleneck is the seat-level atomic claim, not the request rate, so the design is about serialising a small critical section.",
      },
      {
        label: "Hold storage",
        value: "~1 MB for 10,000 holds",
        working: "10,000 × ~100 bytes (seat id, user, expiry) = 1 MB. Tiny — holds belong in memory or Redis, not in the transactional database.",
      },
      {
        label: "Hold TTL",
        value: "~5-10 minutes",
        working: "Long enough to enter card details, short enough that inventory does not leak. Too long and a popular show has all its seats held by users who will not buy.",
      },
      {
        label: "Browse QPS",
        value: "~100,000/s at the peak",
        working: "1M users polling the seat map. This is the path that must be cached and possibly degraded — serving a stale seat map is acceptable, double-selling is not.",
      },
    ],
    deepDives: [
      {
        component: "Seat reservation",
        probe: "Two users click the same seat at the same millisecond. What is the mechanism that stops both from buying it?",
        strongAnswer:
          "An atomic conditional write: `UPDATE seats SET status='held', holder=? WHERE id=? AND status='available'` and check that one row was affected, or a Redis SETNX with a TTL, or a database row lock. The essential property is that the check and the write are one operation. Read-then-write, even inside a transaction at READ COMMITTED, is the failure mode. The strong answer names the isolation level and why the atomic conditional write does not depend on it.",
      },
      {
        component: "Holds and expiry",
        probe: "A user holds a seat and closes the browser. How does it become available again?",
        strongAnswer:
          "A TTL on the hold, with a lazy expiry check at read time plus a background sweeper, or a Redis key TTL that expires the hold automatically. A hold with no expiry is inventory leak, and a sweeper alone is not enough because the sweeper can lag. The tradeoff is that a user who is mid-payment when the TTL fires loses the seat, so the payment path must extend the hold before it expires.",
      },
      {
        component: "Waiting room",
        probe: "One million users hit the on-sale instant. What do you do before they reach the seat map?",
        strongAnswer:
          "A virtual waiting room that admits users at a rate the purchase path can absorb, issuing a token that the purchase path requires. This converts a thundering herd into a controlled queue, and it is a deliberate degradation: most users wait, but nobody gets a double-sold seat or a 500. The tradeoff is fairness — a pure FIFO queue is fair but a lottery is often more acceptable to users than a queue that a fast-refresh client can game.",
      },
      {
        component: "Consistency boundary",
        probe: "Which parts of this system can be eventually consistent, and which cannot?",
        strongAnswer:
          "Browse/search can be eventually consistent — a seat map that is a few seconds stale is fine, and it should be served from a cache or read replica. The hold and purchase path must be linearisable on the seat row. Splitting the two is the design: the stale path absorbs the read load and the small consistent path handles the money. A candidate who makes everything strongly consistent has made browse impossible at 100,000/s.",
      },
    ],
    commonMistakes: [
      "Read-then-write on the seat without an atomic condition",
      "Holds with no TTL, so inventory leaks",
      "Making the browse path strongly consistent",
      "No waiting room, so the purchase path is hit by the full herd",
      "Holding a database row lock across the payment round trip",
    ],
    componentSlug: "fixed-window",
  },
];

/** The client-safe summary. The answer key above is never sent. */
export type DesignPromptSummary = { slug: string; title: string; statement: string };

export function listDesignPrompts(): DesignPromptSummary[] {
  return DESIGN_PROMPTS.map((p) => ({ slug: p.slug, title: p.title, statement: p.statement }));
}

export function getDesignPrompt(slug: string): DesignPrompt | null {
  return DESIGN_PROMPTS.find((p) => p.slug === slug) ?? null;
}
