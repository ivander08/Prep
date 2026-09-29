class Solution {
public:
    int leastInterval(vector<char>& tasks, int n) {
        vector<int> cnt(26, 0);
        for (char c : tasks) cnt[c - 'A']++;
        int mx = 0, nmx = 0;
        for (int v : cnt) mx = max(mx, v);
        for (int v : cnt) if (v == mx) nmx++;
        return max((int)tasks.size(), (mx - 1) * (n + 1) + nmx);
    }
};
