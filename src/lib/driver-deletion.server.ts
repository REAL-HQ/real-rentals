// Destructive cleanup is disabled pending separate retention/Storage acceptance.
// Keep this existing entry point so callers receive an explicit unresolved outcome.
export async function processFileJobs(applicationId: string | null) {
 const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
 let query=supabaseAdmin.from("deletion_file_jobs").select("id",{count:"exact",head:true}).neq("status","done");
 if(applicationId)query=query.eq("application_id",applicationId);
 const r=await query;
 if(r.error||r.count===null)throw Error("Failed — cleanup inventory unavailable; nothing deleted.");
 return {done:0,failed:0,pending:r.count,outcome:"Pending" as const,erasureComplete:false,message:"Cleanup disabled pending separate authorization; no files removed."};
}
