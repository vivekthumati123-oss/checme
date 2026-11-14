# pytest reference

- Files: `tests/unit/<mirror of source path>/test_<name>.py`.
- One plain function per behaviour: `def test_<behaviour>():`.
- Use `pytest.raises(ErrorType)` for failures and `pytest.approx` for floats.
- Use `monkeypatch` or `unittest.mock.patch` for dependencies.
- Use `@pytest.mark.parametrize` for boundary tables instead of loops.
