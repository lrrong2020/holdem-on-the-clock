"""Exercise the native card evaluator through the loaded model."""
from itertools import permutations
from pathlib import Path
import sys

kernel = Path(__file__).resolve().parents[1] / "kernel"
sys.path.insert(0, str(kernel))
from main import load_checkpoint

model = load_checkpoint(kernel / "model")["model"]
assert model.feature_version == 2

# Js 9d on 9s 5s 6c 5c Kh. Counting all 990 possible opponent hands
# gives 694 wins including half credit for ties.
hole = (39, 29)
board = (31, 15, 16, 12, 46)
assert model.equity(hole, board) == 694 / 990

def relabel(cards, suits):
    return tuple(card // 4 * 4 + suits[card % 4] for card in cards)


for count in (3, 4, 5):
    visible = board[:count]
    equity = model.equity(hole, visible)
    bucket = model.bucket(hole, visible)
    for suits in permutations(range(4)):
        assert model.equity(relabel(hole, suits), relabel(visible, suits)) == equity
        assert model.bucket(relabel(hole, suits), relabel(visible, suits)) == bucket
