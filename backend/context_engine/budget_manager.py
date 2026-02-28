from __future__ import annotations

from dataclasses import dataclass
from typing import Any


DEFAULT_TOTAL = 131072
DEFAULT_ALLOCATION = {
    "system_rules_pct": 0.05,
    "cards_pct": 0.15,
    "canon_pct": 0.10,
    "summaries_pct": 0.20,
    "current_draft_pct": 0.30,
    "output_reserve_pct": 0.20,
    "world_pct": 0.10,
}


@dataclass
class BudgetManager:
    total: int
    allocation: dict[str, float]
    caps: dict[str, int]

    @classmethod
    def from_project(cls, project: dict[str, Any], override_total: int | None = None) -> "BudgetManager":
        cfg = project.get("token_budgets", {})
        total = int(override_total or cfg.get("total", DEFAULT_TOTAL))
        allocation = {**DEFAULT_ALLOCATION, **cfg.get("allocation", {})}
        caps = {"max_items_per_bucket": 50, "max_examples_style": 5, **cfg.get("caps", {})}
        return cls(total=total, allocation=allocation, caps=caps)

    def bucket_limits(self) -> dict[str, int]:
        return {
            "system_rules": int(self.total * float(self.allocation.get("system_rules_pct", 0))),
            "cards": int(self.total * float(self.allocation.get("cards_pct", 0))),
            "canon": int(self.total * float(self.allocation.get("canon_pct", 0))),
            "summaries": int(self.total * float(self.allocation.get("summaries_pct", 0))),
            "current_draft": int(self.total * float(self.allocation.get("current_draft_pct", 0))),
            "world": int(self.total * float(self.allocation.get("world_pct", 0))),
            "output_reserve": int(self.total * float(self.allocation.get("output_reserve_pct", 0))),
        }

    def build_report(self, usage: dict[str, int], dropped: list[str]) -> dict[str, Any]:
        limits = self.bucket_limits()
        reasons = {}
        for k, used in usage.items():
            if used > limits.get(k, 0):
                reasons[k] = f"over_limit:{used}>{limits.get(k, 0)}"
        return {
            "total": self.total,
            "limits": limits,
            "usage": usage,
            "caps": self.caps,
            "over_limit": reasons,
            "dropped_items": dropped,
        }
