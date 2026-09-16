from pathlib import Path
import shutil
root=Path.cwd(); target=root/'.acceptance/m10/recovery-source'
target.mkdir(parents=True,exist_ok=True)
shutil.copy2(root/'package.json',target/'package.json')
shutil.copytree(root/'convex',target/'convex',dirs_exist_ok=True)
shutil.copytree(root/'src/lib',target/'src/lib',dirs_exist_ok=True)
(target/'convex/crons.ts').write_text('import { cronJobs } from "convex/server"; export default cronJobs();\n',encoding='utf-8')
s=(root/'tests/support/operations-unit-fixture.ts').read_text(encoding='utf-8')
seed=s.split('  const users = await t.run(async (ctx) => {')[1].split('\n  });')[0]
(target/'convex/drill.ts').write_text('''import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import type { Role } from "../src/lib/permissions";
export const seed = internalMutation({args: {}, handler: async(ctx) => { if (await ctx.db.query("users").first()) throw Error("NONEMPTY_SOURCE"); '''+seed+''' }});
export const won = internalMutation({args: { id: v.id("opportunities") }, handler: async(ctx,a) => { await ctx.db.patch(a.id, {stage: "won", won_at: new Date().toISOString()}); }});
export const snapshot = internalQuery({args: {}, handler: async(ctx) => {const out: Record<string, unknown>={}; for (const table of Object.keys(schema.tables)) out[table] = await ctx.db.query(table as never).collect(); return out; }});
export const store = internalAction({args: {}, handler: async(ctx) => ctx.storage.store(new Blob(["Fictional restore storage integrity"], {type:"text/plain"}))});
export const storage = internalQuery({args: {id:v.id("_storage")},handler: async(ctx,a)=>ctx.storage.getUrl(a.id)});
''',encoding='utf-8')
fixtures=target/'fixtures';fixtures.mkdir(exist_ok=True)
s=s.replace('import { convexTest } from "convex-test";','import { ConvexHttpClient } from "convex/browser";\nimport { makeFunctionReference } from "convex/server";')
s=s.replace('import schema from "../../convex/schema";','').replace('../../convex/','../convex/').replace('../../src/','../src/')
s=s.replace('const modules = import.meta.glob("../convex/**/*.ts");','')
a=s.index('  const t = convexTest');b=s.index('  const who =',a)
s=s[:a]+'''  const admin = new ConvexHttpClient(process.env.GLARA_DRILL_URL!);
  admin.setAdminAuth(process.env.GLARA_DRILL_KEY!);
  const users = await admin.mutation(makeFunctionReference("drill:seed"), {});
  const t = { run: async () => { throw Error("UNSUPPORTED_PRIVATE_FIXTURE_OPERATION"); } };
'''+s[b:]
s=s.replace('const c = (role: Role) => t.withIdentity({ subject: who(role).subject });','const c = (role: Role) => { const client = new ConvexHttpClient(process.env.GLARA_DRILL_URL!); client.setAdminAuth(process.env.GLARA_DRILL_KEY!, {subject: who(role).subject, issuer: "isolated-fictional"}); return client; };')
a=s.index('  const won =');b=s.index('  const create =',a);s=s[:a]+'  const won = () => admin.mutation(makeFunctionReference("drill:won"), {id: oid});\n'+s[b:]
(fixtures/'operations-unit-fixture.ts').write_text(s,encoding='utf-8')
for name in ['inventory','commercial']:
 s=(root/f'tests/support/{name}-unit-fixture.ts').read_text(encoding='utf-8').replace('../support/','./').replace('../../convex/','../convex/').replace('../../src/','../src/')
 (fixtures/f'{name}-unit-fixture.ts').write_text(s,encoding='utf-8')
