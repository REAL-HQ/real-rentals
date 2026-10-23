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
   const { getRequest } = await import('@tanstack/react-start/server');
   const request=getRequest();
   const bearer=request.headers.get('authorization');
   if(!bearer?.startsWith('Bearer ')) throw new Error('Authenticated session required');
   const {ensureRecordRentalResources}=await import('./record-rental-resources.server');
   await ensureRecordRentalResources();
   const {getRecordRentalTransportV2}=await import('./record-rental-runtime.server');
   const {executeRecordRental}=await import('./record-rental-operation.server');
   return executeRecordRental(data.request,data.expectedActorId,
     getRecordRentalTransportV2(context,bearer.slice(7)),request.signal);
 });
