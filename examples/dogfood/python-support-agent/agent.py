#!/usr/bin/env python3
"""
AgentPulse Dogfood: Python Support Agent

A standalone AI support agent workflow instrumented using the stdlib-only
AgentPulse Python client (agentpulse_client.py).
"""

import json
import os
import sys

# Provide development defaults if not explicitly set in the environment
os.environ.setdefault("AGENTPULSE_URL", "http://127.0.0.1:3000")
os.environ.setdefault("AGENTPULSE_INGEST_KEY", "ap_live_support_agent_demo")
os.environ.setdefault("AGENTPULSE_PROJECT_ID", "python-support-agent")
os.environ.setdefault("AGENTPULSE_PROJECT_NAME", "Python Support Agent")
os.environ.setdefault("AGENTPULSE_WORKFLOW_ID", "customer-support-v1")
os.environ.setdefault("AGENTPULSE_ENABLED", "true")

from agentpulse_client import AgentPulseClient


def run_support_agent() -> None:
    print("=== AgentPulse Dogfood: Python Support Agent ===")
    print(f"Endpoint: {os.environ.get('AGENTPULSE_URL')}")
    print(f"Project:  {os.environ.get('AGENTPULSE_PROJECT_ID')}")

    pulse = AgentPulseClient()
    print(f"Enabled:  {pulse.is_enabled}")

    # 1. Start Run
    run_id = pulse.start_run(
        summary="Customer inquiry: Billing invoice dispute #INV-4412"
    )
    print(f"[Run Started] run_id={run_id}")

    try:
        # 2. Emit model call evidence: Intent classification
        print("Step 1: Classifying dispute details...")
        pulse.model_call_completed(
            run_id,
            node_id="billing_classifier",
            model_provider="anthropic",
            model_name="claude-3-5-sonnet",
            input_tokens=220,
            output_tokens=55,
            cost_usd=0.0014,
            duration_ms=450,
            input_summary="User inquiry: 'I was double-charged on invoice INV-4412.'",
            output_summary="Intent: invoice_dispute, Invoice ID: INV-4412, Reason: duplicate_charge",
        )

        # 3. Emit tool call evidence: Billing database query
        print("Step 2: Looking up billing record...")
        tool_args = {"invoice_id": "INV-4412"}
        tool_result = {
            "invoice_id": "INV-4412",
            "amount_cents": 4900,
            "status": "settled",
            "duplicate_detected": True,
            "refund_eligible": True,
        }

        pulse.tool_call_completed(
            run_id,
            node_id="billing_db_query",
            tool_name="lookup_invoice",
            permission_class="read_only",
            duration_ms=65,
            cost_usd=0.0,
            input_summary=json.dumps(tool_args),
            output_summary=json.dumps(tool_result),
        )

        # 4. Emit replay-grade boundary capture
        print("Step 3: Recording execution boundary...")
        pulse.capture_boundary(
            run_id,
            {
                "boundaryType": "tool_call",
                "name": "lookup_invoice",
                "nodeId": "billing_db_query",
                "durationMs": 65,
                "input": tool_args,
                "output": tool_result,
                "declaredSideEffectClass": "read_only",
            },
        )

        # 5. Emit model call evidence: Response formulation
        print("Step 4: Formulating resolution message...")
        pulse.model_call_completed(
            run_id,
            node_id="response_composer",
            model_provider="anthropic",
            model_name="claude-3-5-sonnet",
            input_tokens=310,
            output_tokens=95,
            cost_usd=0.0023,
            duration_ms=520,
            input_summary="Formulate response confirming duplicate charge and refund initiation",
            output_summary="We verified the duplicate charge on INV-4412 and have initiated a $49.00 refund to your original payment method.",
        )

        # 6. Complete Run
        print("Step 5: Completing run...")
        pulse.complete_run(
            run_id,
            summary="Billing inquiry resolved: confirmed duplicate and initiated refund",
            total_cost_usd=0.0037,
            total_duration_ms=1035,
        )

        print("✓ Success: Python support agent run completed and recorded.")

    except Exception as exc:
        print(f"✗ Agent run encountered error: {exc}", file=sys.stderr)
        pulse.fail_run(run_id, error_summary=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    run_support_agent()
