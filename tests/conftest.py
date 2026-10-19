import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from charsheet.data import default_tables  # noqa: E402
from charsheet.render import load_assets  # noqa: E402


@pytest.fixture(scope="session")
def tables():
    return default_tables()


@pytest.fixture(scope="session")
def assets():
    return load_assets()


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()
