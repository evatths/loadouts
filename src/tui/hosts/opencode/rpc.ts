import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";

export const LoadoutsRPC = Rpc.define({
  id: "loadouts",
  methods: {
    status: { input: z.object({ sessionID: z.string() }), output: z.object({ names: z.array(z.string()), fingerprint: z.string().optional() }) },
    equip: { input: z.object({ sessionID: z.string(), names: z.array(z.string()), scope: z.enum(["project", "global"]) }), output: z.object({ names: z.array(z.string()), warnings: z.array(z.string()) }) },
    unequip: { input: z.object({ sessionID: z.string() }), output: z.object({ warnings: z.array(z.string()) }) },
  },
  events: { changed: { schema: z.object({ sessionID: z.string() }) } },
});
