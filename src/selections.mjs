import {SCHOOLS} from './schools.mjs';
export async function selectedSchools(env,binding){
 if(!binding)return [];
 const saved=await env.DB.prepare('SELECT schools FROM school_selections WHERE scope_id=?').bind(binding.scope_id).first();
 if(saved){
  try{const values=JSON.parse(saved.schools);if(Array.isArray(values)){const valid=[...new Set(values)].filter(id=>Object.hasOwn(SCHOOLS,id));if(valid.length)return valid;}}catch{}
 }
 return [binding.school];
}
