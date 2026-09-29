class Solution {
public:
    bool isValidSudoku(vector<vector<char>>& board) {
        for (int i = 0; i < 9; i++) {
            set<char> r, c;
            for (int j = 0; j < 9; j++) {
                if (board[i][j] != '.' && !r.insert(board[i][j]).second) return false;
                if (board[j][i] != '.' && !c.insert(board[j][i]).second) return false;
            }
        }
        for (int b = 0; b < 9; b++) {
            set<char> s;
            for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) {
                char ch = board[(b / 3) * 3 + i][(b % 3) * 3 + j];
                if (ch != '.' && !s.insert(ch).second) return false;
            }
        }
        return true;
    }
};
