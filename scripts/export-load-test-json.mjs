// Emit the same synthetic fixture used by the opt-in Vite preview as JSON.
import {createServer} from 'vite';
const values=new Map();
globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
globalThis.window={setTimeout};
const server=await createServer({optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
try {
  const {seedLoadTest}=await server.ssrLoadModule('/scripts/load-test-fixture.mjs');
  await seedLoadTest();
  process.stdout.write(values.get('centremanager.dev.settings_store_v1'));
} finally {await server.close();}
