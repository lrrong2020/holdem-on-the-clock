"""Inference entry points for the bundled heads-up Kernel model."""

import hashlib
import pickle

from checkpoint import FORMAT, checkpoint_metadata

REVEALED = (0, 3, 4, 5)
CHECKPOINT_SHA256 = "33e9e3e47e064c64b50819f2ba3ae83790c63b85e926f7e78f8eb6e5f5c273cb"


def load_checkpoint(folder):
    data = (folder / "checkpoint.pkl").read_bytes()
    # Verify the exact bytes passed to pickle before it can import checkpoint classes.
    if hashlib.sha256(data).hexdigest() != CHECKPOINT_SHA256:
        raise ValueError("Bundled Kernel checkpoint checksum mismatch.")
    state = pickle.loads(data)
    if state["format"] != FORMAT:
        raise ValueError("Unsupported Kernel checkpoint format.")
    if state.get("metadata") != checkpoint_metadata(state["model"]):
        raise ValueError("Bundled Kernel game or card abstraction mismatch.")
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
            self.equities[key] = self.model.equity(self.holes[actor], self.board[:REVEALED[street]])
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
