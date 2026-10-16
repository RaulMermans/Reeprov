import { ExperimentLabView } from "@/components/proof-layer/ExperimentLabView";

export const metadata = {
  title: "Experiment Lab | Reeprov",
  description: "Controlled agent experiments, repeatability aggregation, and policy-driven candidate ranking.",
};

export default function ExperimentLabPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ExperimentLabView />
    </div>
  );
}
