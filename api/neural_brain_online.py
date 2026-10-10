"""Feature-based online logistic learner, ported from the former Next.js routes.

State is supplied by the transactional SQLite owner; this module does no I/O.
"""
from copy import deepcopy
import math
import os
import re
from api.neural_brain import now_iso, clamp

TASKS = ("targetHit", "reversal", "chop", "buyWin", "sellWin")
ENGINE_VERSION = "neural_brain_phase3_river_style_online_v1"
READY_EXAMPLES = int(os.getenv("NEURAL_BRAIN_ONLINE_READY_EXAMPLES", "25"))


def initial_state():
    stamp = now_iso()
    rate = float(os.getenv("NEURAL_BRAIN_ONLINE_LEARNING_RATE", "0.035"))
    penalty = float(os.getenv("NEURAL_BRAIN_ONLINE_L2", "0.00025"))
    return {"eventType": "NEURAL_BRAIN_ONLINE_STATE", "engineVersion": ENGINE_VERSION,
            "modelType": "river_style_online_logistic",
            "learningRate": rate if math.isfinite(rate) and rate > 0 else 0.035,
            "l2": penalty if math.isfinite(penalty) and penalty >= 0 else 0.00025,
            "tasks": {key: {"weights": {"bias": 0}, "examples": 0, "correct": 0} for key in TASKS},
            "createdAt": stamp, "updatedAt": stamp}


def js_number(value):
    # Match Number() for scalar inputs used in the original feature extractor.
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def feature_vector(payload):
    features = {"bias": 1}

    def add(key, value):
        number = js_number(value)
        if not math.isfinite(number):
            number = 0
        if abs(number) > 1.5:
            number /= 100
        features[re.sub(r"[^a-zA-Z0-9_]", "_", key)[:64]] = max(-5, min(5, number))

    def flatten(prefix, value, depth=0):
        if depth > 3 or value is None:
            return
        if isinstance(value, (int, float, bool)):
            add(prefix, value)
        elif isinstance(value, str):
            if math.isfinite(js_number(value)):
                add(prefix, value)
        elif isinstance(value, list):
            add(prefix + "_count", len(value))
            for index, item in enumerate(value[:20]):
                flatten(f"{prefix}_{index}", item, depth + 1)
        elif isinstance(value, dict):
            for key, item in list(value.items())[:80]:
                flatten(f"{prefix}_{key}", item, depth + 1)

    def direction(value):
        text = str(value or "").lower()
        if any(key in text for key in ("bull", "buy", "long")):
            return 1
        if any(key in text for key in ("bear", "sell", "short")):
            return -1
        return 0

    for key in ("buyConfidence", "sellConfidence", "targetHitProbability", "reversalRisk", "chopRisk", "decisionStrength"):
        add(key, payload.get(key))
    add("bestDirectionFlag", direction(payload.get("bestDirection")))
    add("decisionFlag", direction(payload.get("decision")))
    add("riskWatch", int("risk" in str(payload.get("riskStatus", "")).lower() or bool(payload.get("noTradeWarning"))))
    stored = payload.get("scorecardInputs") or {}
    flatten("input", payload.get("inputs") or stored.get("inputs") or {})
    flatten("scorecard", stored)
    return features


def probability(task, features):
    weights = task["weights"]
    total = weights.get("bias", 0) + sum(weights.get(key, 0) * value for key, value in features.items() if key != "bias")
    return 1 / (1 + math.exp(-max(-40, min(40, total))))


def examples(state):
    return sum(state["tasks"][key]["examples"] for key in TASKS)


def status(state):
    count = examples(state)
    return {"eventType": "NEURAL_BRAIN_ONLINE_STATUS", "status": "Ready",
            "engineVersion": state["engineVersion"], "modelType": state["modelType"],
            "onlineReady": count >= READY_EXAMPLES, "readyAfterExamples": READY_EXAMPLES,
            "trainedExamples": count, "learningRate": state["learningRate"], "l2": state["l2"],
            "tasks": {key: {"examples": task["examples"], "accuracy": round(task["correct"] / task["examples"] * 100, 2) if task["examples"] else 0,
                            "featureWeights": len(task["weights"]), **{field: task.get(field) for field in ("lastPrediction", "lastTarget", "lastUpdatedAt")}}
                      for key, task in state["tasks"].items()}, "updatedAt": state["updatedAt"], "createdAt": now_iso()}


def learn(state, snapshot):
    state = deepcopy(state)
    outcome = snapshot.get("outcome")
    if not outcome:
        return state
    features = feature_vector(snapshot)
    target, reversal, chop = (bool(outcome.get(key)) for key in ("targetHit", "reversalHappened", "chopHappened"))
    labels = {"targetHit": target, "reversal": reversal, "chop": chop}
    direction = str(snapshot.get("bestDirection", "")).lower()
    if "bull" in direction:
        labels["buyWin"] = target and not reversal and not chop
    if "bear" in direction:
        labels["sellWin"] = target and not reversal and not chop
    for name, label in labels.items():
        task = state["tasks"][name]
        predicted = probability(task, features)
        error = int(label) - predicted
        task["weights"]["bias"] = task["weights"].get("bias", 0) + state["learningRate"] * error
        for key, value in features.items():
            if key != "bias":
                task["weights"][key] = task["weights"].get(key, 0) * (1 - state["learningRate"] * state["l2"]) + state["learningRate"] * error * value
        task.update(examples=task["examples"] + 1, correct=task["correct"] + int((predicted >= .5) == label),
                    lastPrediction=round(predicted * 100, 2), lastTarget=int(label), lastUpdatedAt=now_iso())
    state["updatedAt"] = now_iso()
    return state


def apply_prediction(state, scorecard):
    features = feature_vector(scorecard)
    count = examples(state)
    ready = count >= READY_EXAMPLES
    task_fields = {"targetHit": "targetHitProbability", "reversal": "reversalRisk", "chop": "chopRisk", "buyWin": "buyConfidence", "sellWin": "sellConfidence"}
    probabilities, blended = {}, {}
    for task, field in task_fields.items():
        online = probability(state["tasks"][task], features) * 100 if state["tasks"][task]["examples"] else None
        probabilities[task] = online if online is not None else scorecard[field]
        blended[field] = clamp(scorecard[field] * .72 + online * .28) if ready and online is not None else scorecard[field]
    buy, sell, target, reversal, chop = (blended[key] for key in ("buyConfidence", "sellConfidence", "targetHitProbability", "reversalRisk", "chopRisk"))
    direction = "bullish" if buy > sell + 5 else "bearish" if sell > buy + 5 else "neutral"
    decision = "wait_for_alignment" if direction == "neutral" else direction + ("_continuation" if target >= 55 and reversal < 55 and chop < 62 else "_watch")
    if direction != "neutral" and (reversal >= 62 or chop >= 68):
        decision += "_with_risk"
    blended = {key: round(value, 2) for key, value in blended.items()}
    blended.update(decisionStrength=round(clamp(abs(buy - sell)), 2), bestDirection=direction, decision=decision,
                   noTradeWarning=chop >= 62 or reversal >= 70 or target < 38)
    online = {"eventType": "NEURAL_BRAIN_ONLINE_PREDICTION", "status": "Ready", "modelType": "river_style_online_logistic",
              "onlineReady": ready, "trainedExamples": count, "probabilities": probabilities, "blended": blended,
              "featureCount": len(features), "createdAt": now_iso()}
    return {**scorecard, **blended, "onlineLearning": online, "trainedModelReady": ready,
            "modelType": "phase3_river_style_online_blended_scorecard" if ready else scorecard["modelType"],
            "explain": [*scorecard.get("explain", []), f"Online learner: {count}/{READY_EXAMPLES} updates; blending {'active' if ready else 'pending'}." ]}
