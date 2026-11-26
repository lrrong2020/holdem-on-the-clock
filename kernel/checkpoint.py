"""Checkpoint compatibility checks for the public tree and private card abstraction."""
import hashlib
import json
import math

import cards
import game

FORMAT = 2


def _encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii")


def _tree_digest(root):
    """Hash preorder, including legal edge order, information keys and leaf payoffs."""
    digest = hashlib.sha256()
    pending = [root]
    while pending:
        node = pending.pop()
        payoffs = [node.utility(w) for w in (-1, 0, 1)] if node.actor == -1 else None
        record = (node.index, node.history, node.street, node.actor, node.stacks, node.bets,
                  node.to_call, node.actions, node.amounts, node.fold_winner, payoffs)
        digest.update(_encode(record))
        digest.update(b"\n")
        pending.extend(reversed(node.children))
    return digest.hexdigest()


def _game_config():
    return dict(start_chips=game.START, small_blind=game.SB, big_blind=game.BB,
                streets=game.STREETS, actions=game.ACTIONS, max_raises_per_street=game.MAX_RAISES,
                tree_sha256=_tree_digest(game.ROOT))


def checkpoint_metadata(model):
    if model.feature_version != cards.FEATURE_VERSION:
        raise ValueError(f"Checkpoint requires a different card feature version ({model.feature_version}).")
    if (not isinstance(model.rollouts, int) or model.rollouts <= 0 or len(model.centers) != 3
            or any(not 1 <= len(row) <= 256
                   or tuple(row) != tuple(sorted(row))
                   or any(not math.isfinite(x) or not 0 <= x <= 1 for x in row)
                   for row in model.centers)):
        raise ValueError("Invalid card abstraction in checkpoint.")
    return dict(game=_game_config(), card_feature_version=model.feature_version, rollouts=model.rollouts,
                centers_sha256=hashlib.sha256(_encode(model.centers)).hexdigest())
