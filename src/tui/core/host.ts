import type { DashboardData } from "./data.js";
import type { ThemeTokens } from "./theme.js";
import type { SessionEquipment } from "../../integrations/opencode/session.js";

export interface HostContext {
  theme(): ThemeTokens;
  requestRender(): void;
  exit(): void;
  openEditor(path: string): Promise<void>;
  data: DashboardData;
  session?: { id: string; activator: SessionEquipment };
}
