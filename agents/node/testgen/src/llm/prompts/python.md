### Python Addendum

- Write **pytest** tests (plain `def test_<name>():` functions with `assert` and `with pytest.raises(...):`). Do not subclass `unittest.TestCase`.
- Import the target symbols strictly via `conventions.importHint`.
- Use `unittest.mock.Mock` / `unittest.mock.patch` or `pytest` fixtures (`monkeypatch`) only for external boundaries — NEVER mock the target function under test.
- Cover happy paths, edge inputs, and raised exception types with `pytest.raises(...)`.

