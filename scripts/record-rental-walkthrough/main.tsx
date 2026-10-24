import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import { RecordRentalDialog } from "@/components/admin/RecordRentalDialog";
const vehicles = [{ id: "10000000-0000-4000-8000-000000000004", year: 2023, color: "Silver", make: "Toyota", model: "Camry", license_plate: "SMPL 101" },
  { id: "10000000-0000-4000-8000-000000000005", year: 2022, color: "Blue", make: "Honda", model: "Accord", license_plate: "SMPL 202" }];
createRoot(document.getElementById("root")!).render(
  <RecordRentalDialog driver={{ id: "10000000-0000-4000-8000-000000000002", full_name: "Jordan Sample" }} vehicles={vehicles} onClose={() => {}} onRecorded={() => {}} />);
