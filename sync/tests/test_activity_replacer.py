"""Tests for activity replacer orchestration."""

import json
import os
import tempfile

from activity_replacer import (
    load_manifest,
    save_manifest,
)


def test_manifest_round_trip():
    with tempfile.TemporaryDirectory() as tmpdir:
        manifest = {"hevy_abc123": {"status": "uploaded", "hevy_id": "abc123"}}
        save_manifest(manifest, tmpdir)
        loaded = load_manifest(tmpdir)
        assert loaded == manifest


def test_manifest_missing_returns_empty():
    with tempfile.TemporaryDirectory() as tmpdir:
        loaded = load_manifest(tmpdir)
        assert loaded == {}
