import { RegressionStudioView } from "@/components/proof-layer/RegressionStudioView";

export const metadata = {
  title: "Regression Studio | AgentPulse",
  description:
    "Continuous evidence gates, case regression detection, capability drift, and policy governance across agent versions.",
};

export default function RegressionStudioPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <RegressionStudioView />
    </div>
  );
}
