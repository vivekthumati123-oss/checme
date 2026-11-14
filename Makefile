export PYTHONPATH := packages/python:.

.PHONY: install check test test-python demo demo-python demo-tasksync package catalog wi-doctor clean

install:
	npm install --no-audit --no-fund
check:
	npm run check
test:
	node --test "tests/node/**/*.test.js"
	python -m unittest discover -s tests/python
test-python:
	python -m unittest discover -s tests/python
demo:
	node scripts/demo.js
demo-tasksync:
	node scripts/demo.js --tasksync
demo-python:
	AGENT_RUNTIME=mock EVENT_FILE=examples/sample-events/schedule.json METRICS_FIXTURE=examples/sample-events/copilot-metrics.json MONTHLY_BUDGET=300 python -m agents.python.finops.main
package:
	node scripts/package.js
catalog:
	node scripts/build-catalog.js
wi-doctor:
	node .github/skills/work-items/scripts/wi.mjs doctor
clean:
	rm -rf node_modules .l2 dist
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
