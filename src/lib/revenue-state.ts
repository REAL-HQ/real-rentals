/** Session lifecycle for the revenue card. No provider or mutation capabilities. */
export type RevenueSession = { epoch:number; ready:boolean; collections:boolean };
export function createRevenueBoundary(authorize:(id:string)=>Promise<{ allowed:boolean; collections:boolean }>,
 invalidate:()=>void, publish:(state:RevenueSession)=>void) {
 let epoch=0, disposed=false;
 return {
  ticket:()=>epoch,
  change(userId:string|null) {
   const current=++epoch; invalidate(); publish({epoch:current,ready:false,collections:false});
   if(!userId || disposed) return;
   // Defer Supabase calls out of its synchronous Auth callback.
   void Promise.resolve().then(()=>authorize(userId)).then(role=>{
    if(!disposed && current===epoch) publish({epoch:current,ready:role.allowed,collections:role.allowed && role.collections});
   }).catch(()=>{ /* Remain unavailable; never retain a prior account's state. */ });
  },
  dispose(){disposed=true;epoch++;}
 };
}
