import json
import os
import unittest
from pathlib import Path

from agent_core import HookRunner, InstructionSet, PolicyEngine, PolicyViolationError, PromptComposer, automation_task, load_binding, load_skill, matches_glob, parse_yaml, repo_root

ROOT = repo_root(Path(__file__).resolve().parent)


class CoreTests(unittest.TestCase):
    def test_yaml_and_glob_parity(self) -> None:
        doc = parse_yaml("rules:\n  - action: file.write\n    conditions:\n      paths:\n        - tests/**\n")
        self.assertEqual(doc["rules"][0]["conditions"]["paths"], ["tests/**"])
        self.assertTrue(matches_glob("**/*.test.js", "a.test.js"))
        self.assertFalse(matches_glob("tests/*", "tests/unit/a.py"))
        self.assertEqual(json.loads(automation_task({"task": "x"}))["mode"], "automation")

    def test_binding_model(self) -> None:
        self.assertEqual(load_binding("finops", ROOT).model, "gpt-5")
        planned = load_binding("architectconnect", ROOT)
        self.assertIsNone(planned.model)
        os.environ["L2_DEFAULT_MODEL"] = "org-default"
        try:
            self.assertEqual(planned.model, "org-default")
        finally:
            del os.environ["L2_DEFAULT_MODEL"]

    def test_instructions_skills_composer(self) -> None:
        names = [i.name for i in InstructionSet.load(ROOT).resolve_for(["src/a.py"])]
        self.assertIn("python", names)
        self.assertEqual(load_skill("aaa-unit-tests", ROOT).find_reference("pytest"), "references/pytest.md")
        prompt = PromptComposer(load_binding("tasksync", ROOT)).add_agent().add_skills().build()
        self.assertNotIn("skill:work-items", prompt.included)

    def test_policy_and_hooks(self) -> None:
        engine = PolicyEngine(load_binding("testgen", ROOT).policy)
        self.assertFalse(engine.evaluate("file.write", {"path": ".github/workflows/a.test.js"}).allowed)
        with self.assertRaises(PolicyViolationError):
            engine.authorize("file.write", {"path": "src/app.py"})
        hooks = HookRunner.load(ROOT, ["l2-guardrails"])
        self.assertEqual(hooks.allow_tool("bash", {"command": "cat .env.local"}).decision, "deny")


if __name__ == "__main__":
    unittest.main()
