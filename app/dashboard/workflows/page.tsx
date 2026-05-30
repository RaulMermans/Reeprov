import { getWorkflowGalleryItems } from "@/lib/proof-layer/examples";
import { WorkflowsPageClient } from "./WorkflowsPageClient";

export default function WorkflowsPage() {
  const exampleItems = getWorkflowGalleryItems();
  return <WorkflowsPageClient exampleItems={exampleItems} />;
}
