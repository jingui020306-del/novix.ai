"""Compatibility module for test runners importing `main` from repo root."""

from backend.main import app, store

__all__ = ["app", "store"]
