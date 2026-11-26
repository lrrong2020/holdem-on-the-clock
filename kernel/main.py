"""Inference entry points for the bundled heads-up Kernel model."""

import hashlib
import pickle

import cards

REVEALED = (0, 3, 4, 5)
CHECKPOINT_SHA256 = "57e7adf1b2ff9935091b75974697018c2fef49b2b98692a21560fe4fa047dc39"


def load_checkpoint(folder):
    data = (folder / "checkpoint.pkl").read_bytes()
    # Verify the exact bytes passed to pickle before it can import checkpoint classes.
    if hashlib.sha256(data).hexdigest() != CHECKPOINT_SHA256:
        raise ValueError("Bundled Kernel checkpoint checksum mismatch.")
    state = pickle.loads(data)
    if state["format"] != 1:
        raise ValueError("Unsupported Kernel checkpoint format.")
    return state


class HandView:
    """Cache only visible-card computations for the two policies in this hand."""

    def __init__(self, holes, board, model):
        self.holes = holes
        self.board = board
        self.model = model
        self.buckets = {}
        self.equities = {}

    def bucket(self, actor, street):
        key = (actor, street)
        if key not in self.buckets:
            self.buckets[key] = self.model.bucket(self.holes[actor], self.board[:REVEALED[street]])
        return self.buckets[key]

    def equity(self, actor, street):
        key = (actor, street)
        if key not in self.equities:
            self.equities[key] = cards.equity(self.holes[actor], self.board[:REVEALED[street]],
                                              self.model.rollouts)
        return self.equities[key]


def equity_action(node, view):
    strength = view.equity(node.actor, node.street)
    odds = node.to_call / (node.pot + node.to_call)
    if strength < odds and "fold" in node.actions:
        return node.actions.index("fold")
    if strength >= 0.85:
        for action in ("pot", "half", "allin"):
            if action in node.actions:
                return node.actions.index(action)
    if strength >= 0.65 and "half" in node.actions:
        return node.actions.index("half")
    return node.actions.index("call")


def bot_action(node, view, solver, rng):
    probs = solver.average(node, view.bucket(node.actor, node.street))
    if probs is None:
        return equity_action(node, view), False
    return rng.choices(range(len(probs)), weights=probs, k=1)[0], True
