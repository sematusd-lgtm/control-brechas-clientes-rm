import * as XLSX from "xlsx";
import executiveData from "../data/executive-map.json";
import marginData from "../data/margin-map.json";

type RecordRow={month:string;week:number;weekKey:string;zone:string;region:string;plant:string;clientCode:string;client:string;workCode:string;work:string;executive:string;margin:number|null;volume:number;loads:number};
type Quality={month:string;rawRows:number;validRows:number;volume:number;coverage:number;excluded:Record<string,number>};
type DataSet={source:string;rules:string[];records:RecordRow[];quality:Quality[];exclusions:Record<string,number>};
type Cell={v?:unknown}|undefined;

const rules=["NUL vacío","Volumen mayor o igual a 3 m³","Volumen entero o terminado en 0,5","Unidad m³","Código de producto de hormigón 110…","Excluir Retira planta","Excluir plantas móviles MIX RM 13C1, 13D1 y M13A","Eliminar duplicados exactos"];
const regionNames:Record<string,string>={"01":"I Tarapacá","02":"II Antofagasta","03":"III Atacama","04":"IV Coquimbo","05":"V Valparaíso","06":"VI O’Higgins","07":"VII Maule","08":"VIII Biobío","09":"IX La Araucanía","10":"X Los Lagos","11":"XI Aysén","12":"XII Magallanes","13":"Región Metropolitana","15":"XV Arica y Parinacota","16":"XVI Ñuble"};
const zoneBy:Record<string,string>={"01":"Norte","02":"Norte","03":"Norte","04":"Norte","15":"Norte","05":"Centro","06":"Centro","13":"Centro","07":"Sur","08":"Sur","09":"Sur","10":"Sur","11":"Sur","12":"Sur","16":"Sur"};
const executiveMap=executiveData as {byPayer:Record<string,string>;byWorkCode:Record<string,string>};
const marginMap=marginData as Record<string,number|null>;
const txt=(v:unknown)=>String(v??"").trim();
const num=(v:unknown)=>typeof v==="number"?v:Number(String(v??"").replace(/\./g,"").replace(",","."));
const normalize=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
function dateValue(v:unknown){if(typeof v==="number"){const x=XLSX.SSF.parse_date_code(v);return x?new Date(x.y,x.m-1,x.d):null;}const s=txt(v),iso=s.match(/(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/),cl=s.match(/([0-3]?\d)[-/]([01]?\d)[-/](20\d{2})/);return iso?new Date(+iso[1],+iso[2]-1,+iso[3]):cl?new Date(+cl[3],+cl[2]-1,+cl[1]):null;}
function isoWeek(d:Date){const x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7));const y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil((((+x-+y)/86400000)+1)/7);}
function geography(plant:string){let p=plant.slice(0,2);if(plant.startsWith("CAL"))p="02";else if(plant.startsWith("MEL"))p="05";else if(plant.startsWith("MAG"))p="12";return{region:regionNames[p]||"Especial / sin región",zone:zoneBy[p]||"Especial"};}

self.onmessage=(event:MessageEvent<{buffer:ArrayBuffer;source:string}>)=>{
 try{
  self.postMessage({type:"progress",message:"Leyendo la estructura del archivo…"});
  const wb=XLSX.read(event.data.buffer,{type:"array",dense:true,cellDates:false,cellFormula:false,cellHTML:false,cellNF:false,cellStyles:false,cellText:false});
  const sheet=wb.Sheets[wb.SheetNames[0]] as unknown as Array<Array<Cell>>;
  if(!Array.isArray(sheet)||!sheet.length)throw new Error("No fue posible leer la primera hoja del archivo.");
  const headers=new Map<string,number>();
  sheet[0]?.forEach((cell,i)=>headers.set(txt(cell?.v).toUpperCase(),i));
  const required=["FECHA","DESPACHADO","COD_PROD","UN","COD_CLI","CLIENTE","COD_OBRA","NOM_OBRA"];
  const missing=required.filter(x=>!headers.has(x));
  if(missing.length)throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);
  const at=(row:Array<Cell>,name:string)=>row[headers.get(name)??-1]?.v;
  const a=new Map<string,RecordRow>(),q=new Map<string,{rawRows:number;validRows:number;volume:number;excluded:Record<string,number>}>(),exclusions:Record<string,number>={},seen=new Set<string>();
  const addEx=(month:string,reason:string)=>{exclusions[reason]=(exclusions[reason]||0)+1;const z=q.get(month);if(z)z.excluded[reason]=(z.excluded[reason]||0)+1;};
  const total=sheet.length-1;
  for(let i=1;i<sheet.length;i++){
   const row=sheet[i];if(!row)continue;const date=dateValue(at(row,"FECHA"));if(!date)continue;
   const month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`,plant=txt(at(row,"LOCAL CMD")||at(row,"CENTRO SAP")).toUpperCase(),volume=num(at(row,"DESPACHADO")),prod=txt(at(row,"COD_PROD")).replace(/\.0$/,"");let reason="";
   const qq=q.get(month)||{rawRows:0,validRows:0,volume:0,excluded:{}};qq.rawRows++;q.set(month,qq);
   if(!Number.isFinite(volume)||volume<=0)reason="Sin volumen / anulado";else if(at(row,"NUL")!==undefined&&at(row,"NUL")!==null&&txt(at(row,"NUL"))!=="")reason="NUL / anulado";else if(txt(at(row,"UN")).toLowerCase()!=="m3")reason="Unidad distinta de m³";else if(txt(at(row,"CONDUCTOR")).toLowerCase().includes("retira planta"))reason="Retira planta";else if(!prod.startsWith("110"))reason="Producto no hormigón";else if(volume<3)reason="Carga menor a 3 m³";else if(Math.abs(Math.round(volume*2)-volume*2)>=1e-8)reason="Volumen fuera de regla 0,5";else if(["13C1","13D1","M13A"].includes(plant))reason="Planta móvil MIX RM";
   if(reason){addEx(month,reason);continue;}
   const duplicate=[txt(at(row,"TICKET")),month,plant,prod,volume,txt(at(row,"COD_CLI")),txt(at(row,"COD_OBRA"))].join("¦");if(seen.has(duplicate)){addEx(month,"Duplicado exacto");continue;}seen.add(duplicate);
   const week=isoWeek(date),geo=geography(plant),clientCode=txt(at(row,"COD_CLI")),client=txt(at(row,"CLIENTE"))||"Cliente sin nombre",workCode=txt(at(row,"COD_OBRA")),work=txt(at(row,"NOM_OBRA"))||"Obra sin nombre",key=[month,week,geo.zone,geo.region,plant,clientCode,client,workCode,work].join("¦"),old=a.get(key);
   qq.validRows++;qq.volume+=volume;if(old){old.volume+=volume;old.loads++;}else a.set(key,{month,week,weekKey:`${date.getFullYear()}-S${String(week).padStart(2,"0")}`,zone:geo.zone,region:geo.region,plant,clientCode,client,workCode,work,executive:"Sin asignar",margin:marginMap[workCode]??null,volume,loads:1});
   if(i%10000===0)self.postMessage({type:"progress",message:`Procesando ${Math.round(i/total*100)}% · ${i.toLocaleString("es-CL")} filas`});
  }
  self.postMessage({type:"progress",message:"Preparando indicadores y filtros…"});
  const records=[...a.values()],byClient=new Map<string,string>();
  for(const row of records){const payer=executiveMap.byPayer[normalize(row.client)],work=executiveMap.byWorkCode[row.workCode];if(payer)byClient.set(row.clientCode,payer);else if(!byClient.has(row.clientCode)&&work)byClient.set(row.clientCode,work);}
  for(const row of records)row.executive=byClient.get(row.clientCode)||"Sin asignar";
  const quality:Quality[]=[...q].sort().map(([month,x])=>({month,...x,coverage:x.rawRows?x.validRows/x.rawRows*100:0}));
  const result:DataSet={source:event.data.source,rules,records,quality,exclusions};
  self.postMessage({type:"done",result});
 }catch(error){self.postMessage({type:"error",message:error instanceof Error?error.message:"No fue posible procesar la base."});}
};
