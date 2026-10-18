import { z } from "zod";
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { recordRequest, recordResult, recordRpcArgs, RECORD_RENTAL_CONTRACT_ENABLED } from './record-rental-contract';
export const recordExistingRentalV3 = createServerFn({method:'POST'})
 .middleware([requireSupabaseAuth]).inputValidator((value: unknown)=>z.object({request:recordRequest,expectedActorId:z.string().uuid()}).strict().parse(value))
 .handler(async ({data,context})=>{
   if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error('Record Rental is disabled pending contract installation and acceptance');
   if (data.expectedActorId !== context.userId) throw new Error("Session changed; reconcile under the original staff account");
   const { requireManager } = await import('./roles.server');
   await requireManager(context.userId);
   // Database revalidates actor, positive review, documents, allocation and evidence under locks.
   const {data:result,error}=await (context.supabase as any).rpc('record_existing_rental_tx',recordRpcArgs(data.request));
   if(error) throw new Error(error.message);
   return recordResult.parse(result);
 });
