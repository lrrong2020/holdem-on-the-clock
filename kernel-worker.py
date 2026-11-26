"""Run the local Kernel checkpoint against one seat's visible cards."""

import json
import random
import sys
from pathlib import Path


def send(message):
    print(json.dumps(message, separators=(",", ":")), flush=True)


def card_id(card):
    if not isinstance(card, str) or len(card) != 2:
        raise ValueError("Invalid card")
    return "23456789TJQKA".index(card[0]) * 4 + "cdhs".index(card[1])


def decide(kernel, root, state, rng, request):
    actions = request["actions"]
    if not isinstance(actions, list) or len(actions) > 32:
        raise ValueError("Invalid action history")
    node = root
    for action in actions:
        node = node.children[node.actions.index(action)]

    actor = request["actor"]
    if type(actor) is not int or actor not in (0, 1) or actor != node.actor:
        raise ValueError("Unexpected actor")
    cards, board = request["cards"], request["board"]
    if not isinstance(cards, list) or len(cards) != 2:
        raise ValueError("Expected two hole cards")
    if not isinstance(board, list) or len(board) != kernel.REVEALED[node.street]:
        raise ValueError("Unexpected board")
    own = tuple(map(card_id, cards))
    public = tuple(map(card_id, board))
    if len(set(own + public)) != len(own) + len(public):
        raise ValueError("Duplicate card")

    # The kernel requests the acting seat only, including for its equity fallback.
    holes = (own, ()) if actor == 0 else ((), own)
    view = kernel.HandView(holes, public, state["model"])
    index, trained = kernel.bot_action(node, view, state["solver"], rng)
    return {"action": node.actions[index], "trained": trained}


def run(directory):
    directory = Path(directory).resolve(strict=True)
    sys.path.insert(0, str(directory))
    import main as kernel
    from game import ROOT
    from cards import equity

    # A ready worker can handle a postflop decision as well as a preflop lookup.
    state = kernel.load_checkpoint(directory / "model")
    equity((0, 1), (2, 3, 4), 1)
    rng = random.Random()
    send({"ready": True, "iterations": state["solver"].iterations})
    for line in sys.stdin:
        message = {}
        try:
            message = json.loads(line)
            result = decide(kernel, ROOT, state, rng, message["request"])
            send({"id": message["id"], **result})
        except (KeyError, IndexError, ValueError, TypeError, AttributeError):
            request_id = message.get("id") if isinstance(message, dict) else None
            send({"id": request_id, "error": "Invalid Kernel decision request"})


if __name__ == "__main__":
    run(sys.argv[1])
