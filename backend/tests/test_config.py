from pathlib import Path

import pytest

from focara.config import Config, ConfigError, load_config, parse_config

EXAMPLE = Path(__file__).resolve().parents[2] / "config" / "config.yaml.example"


def test_defaults() -> None:
    cfg = parse_config(None)
    assert cfg == Config()
    assert cfg.backend.port == 8800
    assert cfg.frontend.port == 3800


def test_example_is_valid() -> None:
    assert load_config(EXAMPLE) == Config()


def test_values_applied(tmp_path: Path) -> None:
    f = tmp_path / "c.yaml"
    f.write_text("backend:\n  port: 8810\nfrontend:\n  port: 3810\n  host: 0.0.0.0\n")
    cfg = load_config(f)
    assert (cfg.backend.port, cfg.frontend.port, cfg.frontend.host) == (8810, 3810, "0.0.0.0")


def test_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    f = tmp_path / "c.yaml"
    f.write_text("backend:\n  port: 9000\n")
    monkeypatch.setenv("FOCARA_CONFIG", str(f))
    assert load_config().backend.port == 9000


def test_missing_explicit_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("FOCARA_CONFIG", str(tmp_path / "none.yaml"))
    with pytest.raises(ConfigError):
        load_config()


def test_missing_default_file_uses_defaults(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("FOCARA_CONFIG", raising=False)
    monkeypatch.chdir(tmp_path)
    assert load_config() == Config()


@pytest.mark.parametrize(
    "raw",
    [
        {"backend": {"port": "8800"}},
        {"backend": {"port": 0}},
        {"backend": {"port": 70000}},
        {"backend": {"port": True}},
        {"backend": {"port": 3800}},  # frontend 既定と重複
        {"frontend": {"host": ""}},
        {"db": {"path": 1}},
        {"db": "x"},
        {"unknown": 1},
        {"backend": {"nope": 1}},
        ["list"],
    ],
)
def test_invalid(raw: object) -> None:
    with pytest.raises(ConfigError):
        parse_config(raw)


def test_invalid_yaml(tmp_path: Path) -> None:
    f = tmp_path / "c.yaml"
    f.write_text("a: [")
    with pytest.raises(ConfigError):
        load_config(f)
