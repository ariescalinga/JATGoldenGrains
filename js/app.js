import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// JAT Golden Grains Trading — Firebase shared database configuration.
const firebaseConfig = {
  apiKey: "AIzaSyBluaKKFE9CIyoF78eFNNZQNzlgyBbgms",
  authDomain: "jatgoldengrains.firebaseapp.com",
  projectId: "jatgoldengrains",
  storageBucket: "jatgoldengrains.firebasestorage.app",
  messagingSenderId: "670530546100",
  appId: "1:670530546100:web:ab9fc767e8f84c09e02ae1",
  measurementId: "G-VGY6BGFC02"
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const businessDataRef = doc(db, "businessData", "main");
const ADMIN_EMAIL = "aries.calinga@gmail.com";
let cloudReady = false;
let cloudUnsubscribe = null;
let applyingCloudData = false;
let lastCloudJson = "";
let saveQueue = Promise.resolve();

const state={
  user:null,
  cart:[],
  products:[
    {id:1,name:"Dinurado",kilo:"25KG",dealer:450,retail:500,stock:18,min:10},
    {id:2,name:"Dinurado",kilo:"10KG",dealer:190,retail:215,stock:25,min:10},
    {id:3,name:"Dinurado",kilo:"5KG",dealer:100,retail:115,stock:7,min:10},
    {id:4,name:"Premium Rice",kilo:"25KG",dealer:500,retail:550,stock:8,min:10}
  ],
  customers:[
    {id:2,name:"Juan Dela Cruz",contact:"09XXXXXXXXX",address:"",storeName:"",balance:350,kg25:0,kg10:0,kg5:0}
  ],
  sales:[],orders:[],expenses:[],purchases:[],payments:[],panukli:0
};

// User credentials are managed by Firebase Authentication, not localStorage.
let accounts={"aries.calinga@gmail.com":{role:"ADMIN",name:"Administrator"}};
function saveAccounts(){ /* Firebase Auth accounts must be managed in Firebase Console. */ }
let selectedProductId=null;
const kiloRank=k=>({"25KG":25,"10KG":10,"5KG":5,"4KG":4,"3KG":3,"2KG":2,"1KG":1}[String(k||"").toUpperCase()]||0);
const sortedProducts=()=>[...state.products].sort((a,b)=>kiloRank(b.kilo)-kiloRank(a.kilo)||a.name.localeCompare(b.name));
const peso=n=>"₱"+Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
const todayISO=()=>new Date().toISOString().slice(0,10);
const dateLabel=()=>new Date().toLocaleDateString("en-PH",{month:"2-digit",day:"2-digit",year:"numeric"});
const dateTimeLabel=()=>new Date().toLocaleString("en-PH",{month:"2-digit",day:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true});
const cloudPayload=()=>({
  products:state.products, customers:state.customers, sales:state.sales, orders:state.orders,
  expenses:state.expenses, purchases:state.purchases, payments:state.payments, panukli:Number(state.panukli||0),
  schemaVersion:1, updatedAtClient:new Date().toISOString(), updatedBy:auth.currentUser?.email||""
});
const save=()=>{
  const localPayload={...state,user:null,cart:[]};
  try{localStorage.setItem("jgg_state",JSON.stringify(localPayload));}catch(e){console.warn("Local backup could not be saved",e)}
  if(!cloudReady||!auth.currentUser||applyingCloudData)return;
  const payload=cloudPayload();
  const json=JSON.stringify(payload);
  lastCloudJson=json;
  saveQueue=saveQueue.then(()=>setDoc(businessDataRef,{...payload,updatedAt:serverTimestamp()})).catch(err=>{
    console.error("Firebase save failed:",err);
    showCloudError("Hindi na-save sa shared database. Suriin ang internet connection at Firestore Rules.");
  });
};
function showCloudError(message){
  const el=document.getElementById("loginError");
  if(el && document.getElementById("loginScreen") && !document.getElementById("loginScreen").classList.contains("hidden")) el.textContent=message;
  else console.warn(message);
}
function applyCloudPayload(data){
  applyingCloudData=true;
  ["products","customers","sales","orders","expenses","purchases","payments"].forEach(k=>{if(Array.isArray(data[k]))state[k]=data[k]});
  if(data.panukli!==undefined)state.panukli=Number(data.panukli)||0;
  normalizeState();
  try{localStorage.setItem("jgg_state",JSON.stringify({...state,user:null,cart:[]}));}catch(_){}
  applyingCloudData=false;
}
const normalizeState=()=>{
  state.panukli=Number(state.panukli||0);

  // IMPORTANT: Preserve existing product records. Older versions of the app
  // used several different property names/storage locations. Recover those
  // records before normalizing them, and never replace real records with an
  // empty array just because the current alias is empty.
  const productKeys=/^(name|product|productname|product_name|producttitle|rice|ricename|rice_name|description|itemname|item_name|kilo|size|unit|weight|productsize|product_size|dealer|dealerprice|dealer_price|cost|costprice|cost_price|retail|retailprice|retail_price|sell|sellprice|sell_price|sellingprice|stock|available|quantity|qty|availablestock|available_stock|minimumstock|minimum_stock|min|id|productid|product_id)$/i;
  const looksLikeProduct=o=>{
    if(!o||typeof o!=='object'||Array.isArray(o))return false;
    const keys=Object.keys(o);
    const hasName=keys.some(k=>/^(name|product|productname|product_name|producttitle|rice|ricename|rice_name|itemname|item_name|Product Name|Rice Name)$/i.test(k)) && keys.some(k=>String(o[k]??'').trim()!=='');
    const hasProductData=keys.some(k=>/^(kilo|size|unit|weight|productsize|product_size|dealer|dealerprice|dealer_price|cost|costprice|cost_price|retail|retailprice|retail_price|sell|sellprice|sell_price|sellingprice|stock|available|quantity|qty|availablestock|available_stock)$/i.test(k));
    return hasName&&hasProductData;
  };
  const collectProductArrays=(root,found=[],seen=new Set())=>{
    if(!root||typeof root!=='object'||seen.has(root))return found; seen.add(root);
    if(Array.isArray(root)){
      const hits=root.filter(looksLikeProduct); if(hits.length)found.push(hits);
      root.forEach(v=>{if(v&&typeof v==='object')collectProductArrays(v,found,seen)});
    }else Object.values(root).forEach(v=>{if(v&&typeof v==='object')collectProductArrays(v,found,seen)});
    return found;
  };
  const recoverSavedProducts=()=>{
    const candidates=[];
    [state.inventory,state.productList,state.productsData,state.riceProducts,state.riceList,state.items,state.product].forEach(v=>{if(Array.isArray(v)&&v.length)candidates.push(v.filter(looksLikeProduct))});
    // Also inspect every localStorage entry. This catches older versions that
    // stored products under a different top-level key.
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i),raw=localStorage.getItem(key); if(!raw)continue;
        try{const parsed=JSON.parse(raw);collectProductArrays(parsed,candidates)}catch(_){}
      }
    }catch(_){}
    const flat=candidates.flat().filter(looksLikeProduct);
    const unique=[]; const seen=new Set();
    flat.forEach(p=>{const n=String(p.name??p.productName??p.product??p.riceName??p.rice??p['Product Name']??p['Rice Name']??'').trim().toLowerCase(); const sz=String(p.kilo??p.size??p.unit??p.weight??'').trim().toUpperCase(); const key=n+'|'+sz; if(n&&!seen.has(key)){seen.add(key);unique.push(p)}});
    return unique;
  };
  const savedProducts=recoverSavedProducts();
  const currentProducts=Array.isArray(state.products)?state.products:[];
  const currentHasRealProducts=currentProducts.some(p=>looksLikeProduct(p)||String(p?.name||'').trim()!=='');
  if(savedProducts.length && (!currentProducts.length || !currentHasRealProducts || currentProducts.every(p=>/^(Dinurado|Premium Rice)$/i.test(String(p?.name||'')) && [1,2,3,4].includes(Number(p?.id))))){
    state.products=savedProducts;
  }else if(!currentProducts.length){
    state.products=savedProducts;
  }
  if(!Array.isArray(state.products)) state.products=[];
  if(!Array.isArray(state.products)) state.products=[];
  state.products=state.products.map((p,i)=>{
    if(!p || typeof p!=='object') return {id:i+1,name:String(p??''),kilo:'',dealer:0,retail:0,stock:0,min:10};
    // Prefer the first NON-BLANK value so an older normalized empty alias
    // does not hide the original product fields that are still preserved.
    const firstValue = (...values) => values.find(v => v !== null && v !== undefined && String(v).trim() !== '');
    const name = firstValue(p.name,p.productName,p.product_name,p.riceName,p.rice_name,p['Product Name'],p['Rice Name'],p.product,p.rice,'') ;
    const kilo = firstValue(p.kilo,p.size,p.unit,p.productSize,p.product_size,p['Kilo'],p['Size'],p.weight,'');
    const dealer = firstValue(p.dealer,p.dealerPrice,p.dealer_price,p.cost,p.costPrice,p.cost_price,p['Dealer Price'],0);
    const retail = firstValue(p.retail,p.retailPrice,p.retail_price,p.sell,p.sellPrice,p.sell_price,p['Retail Price'],p['Selling Price'],0);
    const stock = firstValue(p.stock,p.available,p.quantity,p.qty,p.availableStock,p.available_stock,p['Available'],0);
    const min = firstValue(p.min,p.minimumStock,p.minimum_stock,10);
    const supplierName = firstValue(p.supplierName,p.supplier,p.supplier_name,p['Supplier Name'],'');
    const supplierAddress = firstValue(p.supplierAddress,p.supplier_address,p['Supplier Address'],p.address,'');
    const supplierContact = firstValue(p.supplierContact,p.supplier_contact,p.contactNo,p.contact,p['Contact No.'],'');
    // Keep all original properties, then expose the standard properties used by the UI.
    return {...p,
      id:Number(p.id ?? p.productId ?? p.product_id ?? i+1) || i+1,
      name:String(name).trim(),
      kilo:String(kilo).trim().toUpperCase(),
      dealer:Number(dealer)||0,
      retail:Number(retail)||0,
      stock:Number(stock)||0,
      min:Number(min)||10,
      supplierName:String(supplierName).trim(),
      supplierAddress:String(supplierAddress).trim(),
      supplierContact:String(supplierContact).trim()
    };
  });

  state.customers=(state.customers||[]).filter(c=>String(c.name||"").trim().toLowerCase()!=="walk-in customer"&&String(c.name||"").trim().toLowerCase()!=="walk-in").map((c,i)=>({id:c.id||i+1,name:c.name||"",contact:c.contact||"",address:c.address||"",storeName:c.storeName||"",balance:Number(c.balance||0),kg25:Number(c.kg25||c.count25||0),kg10:Number(c.kg10||c.count10||0),kg5:Number(c.kg5||c.count5||0)}));
  state.payments=state.payments.map((p,i)=>({...p,id:p.id||i+1,customerId:Number(p.customerId)||0,customer:p.customer||"",dateTime:p.dateTime||p.date||"",amount:Number(p.amount)||0,receivedBy:p.receivedBy||"",balanceAfter:Number(p.balanceAfter)||0}));
  state.sales=state.sales||[];state.orders=state.orders||[];state.expenses=state.expenses||[];state.payments=Array.isArray(state.payments)?state.payments:[];state.purchases=(state.purchases||[]).map(x=>({...x,supplierName:x.supplierName||x.supplier||"",supplierAddress:x.supplierAddress||x.address||"",supplierContact:x.supplierContact||x.supplierContactNo||x.contact||"",poNumber:x.poNumber||x.po||"",status:x.status||"Delivered",stockAdded:x.stockAdded!==undefined?!!x.stockAdded:(x.status!=="Pending")}));state.cart=Array.isArray(state.cart)?state.cart:[];

  // Migrate older For Delivery records out of Sales/Reports into pending Customer's Orders.
  const oldDeliverySales=state.sales.filter(s=>s.status==="For Delivery");
  if(oldDeliverySales.length){
    let nextOrderId=state.orders.length?Math.max(...state.orders.map(o=>Number(o.id)||0))+1:1;
    oldDeliverySales.forEach(s=>{
      if(!state.orders.some(o=>o.invoice===s.invoice&&o.product===s.product&&Number(o.qty)===Number(s.qty)&&o.status==="For Delivery")){
        state.orders.push({id:nextOrderId++,date:s.dateTime||s.date||dateTimeLabel(),customer:s.customer||"Walk-in",contact:s.contact||"",address:s.address||"",invoice:s.invoice||"",product:s.product,qty:Number(s.qty)||0,status:"For Delivery",processedBy:s.user||"",delivered:false,dealer:Number(s.dealer)||0,retail:Number(s.retail)||0,paymentMode:s.paymentMode||"Cash",total:Number(s.total)||0,profit:Number(s.profit)||0});
      }
    });
    state.sales=state.sales.filter(s=>s.status!=="For Delivery");
  }

  state.orders.forEach(o=>{
    if(o.status==="For Delivery" && (!Number.isFinite(Number(o.retail)) || Number(o.retail)===0)){
      const m=String(o.product||"").match(/^(.*) \((25KG|10KG|5KG)\)$/i);
      const p=m&&state.products.find(x=>x.name===m[1]&&String(x.kilo).toUpperCase()===m[2].toUpperCase());
      if(p){o.dealer=p.dealer;o.retail=p.retail;o.total=(Number(o.qty)||0)*p.retail;o.profit=(Number(o.qty)||0)*(p.retail-p.dealer);}
    }
  });
};
const load=()=>{
  try{
    const raw=localStorage.getItem("jgg_state");
    if(raw){
      const x=JSON.parse(raw);
      if(x&&typeof x==="object")Object.assign(state,x);
    }
  }catch(e){console.warn("Could not load saved JAT data:",e)}
  normalizeState();
  save();
};
load();

const loginScreen=document.getElementById("loginScreen"),app=document.getElementById("app");
const loginButton=document.querySelector('#loginForm button[type="submit"]');
document.getElementById("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const email=document.getElementById("username").value.trim().toLowerCase();
 const password=document.getElementById("password").value;
 const error=document.getElementById("loginError");
 error.textContent="";
 if(loginButton){loginButton.disabled=true;loginButton.textContent="CONNECTING...";}
 try{await signInWithEmailAndPassword(auth,email,password);}
 catch(err){
   console.error("Firebase login failed:",err);
   const messages={"auth/invalid-credential":"Mali ang email o password. Tiyaking ang account ay nasa Firebase Authentication.","auth/user-not-found":"Walang Firebase Authentication user para sa email na ito.","auth/wrong-password":"Mali ang password.","auth/invalid-email":"Hindi valid ang email address.","auth/too-many-requests":"Maraming nabigong login. Maghintay muna at subukan muli.","auth/network-request-failed":"Walang koneksyon sa internet. Suriin ang iyong connection."};
   error.textContent=messages[err.code]||`Hindi makapag-login sa Firebase (${err.code||"error"}). Suriin ang Firebase Authentication at internet connection.`;
 }finally{if(loginButton){loginButton.disabled=false;loginButton.textContent="LOGIN";}}
});
async function startApp(user){
 if(!user)return;
 const email=String(user.email||"").toLowerCase();
 state.user={username:email,email,role:email===ADMIN_EMAIL?"ADMIN":"CASHIER",name:email===ADMIN_EMAIL?"Administrator":(user.displayName||email)};
 document.querySelectorAll(".page-section").forEach(x=>{x.classList.remove("active");x.setAttribute("aria-hidden","true")});
 try{
   const snap=await getDoc(businessDataRef);
   if(snap.exists()){
     applyCloudPayload(snap.data());
   }else{
     // First-time cloud setup: migrate this browser's existing business data once.
     let local=null;try{local=JSON.parse(localStorage.getItem("jgg_state")||"null")}catch(_){}
     if(local&&typeof local==="object"){
       ["products","customers","sales","orders","expenses","purchases","payments"].forEach(k=>{if(Array.isArray(local[k]))state[k]=local[k]});
       if(local.panukli!==undefined)state.panukli=Number(local.panukli)||0;
     }
     normalizeState();
     await setDoc(businessDataRef,{...cloudPayload(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
     lastCloudJson=JSON.stringify(cloudPayload());
   }
   cloudReady=true;
   if(cloudUnsubscribe)cloudUnsubscribe();
   cloudUnsubscribe=onSnapshot(businessDataRef,snapshot=>{
     if(!snapshot.exists())return;
     const data=snapshot.data();
     const incoming={products:data.products,customers:data.customers,sales:data.sales,orders:data.orders,expenses:data.expenses,purchases:data.purchases,payments:data.payments,panukli:data.panukli};
     const json=JSON.stringify(incoming);
     if(json===lastCloudJson)return;
     lastCloudJson=json;
     applyCloudPayload(data);
     if(state.user){renderAll();}
   },err=>{console.error("Firestore listener error:",err);showCloudError("Hindi ma-sync ang shared database. Suriin ang Firestore Rules.");});
 }catch(err){
   console.error("Firebase data load failed:",err);
   await signOut(auth).catch(()=>{});
   cloudReady=false;
   document.getElementById("loginError").textContent="Nakapasok sa Authentication ngunit hindi mabuksan ang Firestore. I-check ang Firestore Rules at tiyaking may database na ang project.";
   return;
 }
 loginScreen.classList.add("hidden");app.classList.remove("hidden");
 document.getElementById("currentUser").textContent=state.user.name;document.getElementById("currentRole").textContent=state.user.role;document.getElementById("avatar").textContent=state.user.name.charAt(0).toUpperCase();
 app.classList.toggle("cashier",state.user.role==="CASHIER");document.getElementById("todayDate").textContent=dateLabel();applyAccess();renderAll();navigate("dashboard");
}
onAuthStateChanged(auth,user=>{
 if(user){startApp(user);}
 else{
   cloudReady=false;state.user=null;
   if(cloudUnsubscribe){cloudUnsubscribe();cloudUnsubscribe=null;}
   app.classList.add("hidden");loginScreen.classList.remove("hidden");
 }
});
function applyAccess(){
 document.querySelectorAll(".admin-only-section").forEach(x=>x.classList.toggle("visible",state.user.role==="ADMIN"));
 document.querySelectorAll(".admin-only").forEach(x=>x.style.display=state.user.role==="ADMIN"?"flex":"none");
}
function navigate(section){
 const target=document.getElementById(section);if(!target)return;
 if(target.classList.contains("admin-only-section")&&state.user.role!=="ADMIN"){alert("ADMIN access only.");return}
 document.querySelectorAll(".page-section").forEach(x=>{x.classList.remove("active");x.setAttribute("aria-hidden","true")});target.classList.add("active");target.setAttribute("aria-hidden","false");
 document.querySelectorAll(".nav-item").forEach(x=>{const selected=x.dataset.section===section;x.classList.toggle("active",selected);x.setAttribute("aria-current",selected?"page":"false")});
 const title=target.querySelector("h3")?.textContent||"Dashboard";document.getElementById("pageTitle").textContent=title;document.getElementById("pageSubtitle").textContent=section==="dashboard"?"Business overview for today":"Manage "+title.toLowerCase()+".";document.getElementById("sidebar").classList.remove("open");
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.section)));
document.querySelectorAll("[data-section-jump]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.sectionJump)));
document.getElementById("menuBtn").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("logoutBtn").addEventListener("click",async()=>{cloudReady=false;try{await signOut(auth)}catch(e){console.error(e)}});

// Admin-only export of the current shared Firestore document. This is read-only:
// it never modifies or deletes Firestore or localStorage data.
const backupDataButton=document.getElementById("backupDataBtn");
if(backupDataButton){
 backupDataButton.addEventListener("click",async()=>{
   if(state.user?.role!=="ADMIN" || String(auth.currentUser?.email||"").toLowerCase()!==ADMIN_EMAIL){
     alert("ADMIN access only. Hindi ka awtorisadong gumawa ng backup.");return;
   }
   if(!cloudReady){alert("Hindi pa handa ang koneksyon sa Firestore. Maghintay sandali at subukan muli.");return;}
   const originalText=backupDataButton.textContent;
   backupDataButton.disabled=true;backupDataButton.textContent="Preparing backup...";
   try{
     const snapshot=await getDoc(businessDataRef);
     if(!snapshot.exists()){
       alert("Walang shared business data document sa Firestore. Walang na-download na backup.");return;
     }
     const backup={
       backupFormat:"JAT Golden Grains Trading Firestore Backup",
       backupVersion:1,
       exportedAt:new Date().toISOString(),
       firebaseProject:firebaseConfig.projectId,
       firestorePath:"businessData/main",
       data:snapshot.data()
     };
     const json=JSON.stringify(backup,null,2);
     const blob=new Blob([json],{type:"application/json;charset=utf-8"});
     const url=URL.createObjectURL(blob);
     const link=document.createElement("a");
     const stamp=new Date().toISOString().replace(/[:.]/g,"-");
     link.href=url;link.download=`JAT-Golden-Grains-Backup-${stamp}.json`;
     document.body.appendChild(link);link.click();link.remove();
     setTimeout(()=>URL.revokeObjectURL(url),1000);
     alert("Matagumpay na na-download ang backup ng shared Firestore data. Itago ang JSON file sa ligtas na lugar. Hindi binago o binura ang database.");
   }catch(err){
     console.error("Backup export failed:",err);
     alert("Hindi nagawa ang backup. Suriin ang internet connection at Firestore Rules, pagkatapos ay subukan muli.");
   }finally{
     backupDataButton.disabled=false;backupDataButton.textContent=originalText;
   }
 });
}


function renderDashboard(){
 const today=state.sales.filter(s=>s.date===todayISO()),expenses=state.expenses.filter(e=>e.date===todayISO());
 const sales=today.reduce((a,s)=>a+s.total,0),profit=today.reduce((a,s)=>a+s.profit,0),exp=expenses.reduce((a,e)=>a+e.amount,0);
 document.getElementById("salesValue").textContent=peso(sales);document.getElementById("profitValue").textContent=peso(profit);document.getElementById("expensesValue").textContent=peso(exp);
 const low=state.products.filter(p=>p.stock<=p.min);document.getElementById("lowStockValue").textContent=low.length;
 const by=s=>state.products.filter(p=>p.kilo===s).reduce((a,p)=>a+p.stock,0);document.getElementById("stock25").textContent=by("25KG");document.getElementById("stock10").textContent=by("10KG");document.getElementById("stock5").textContent=by("5KG");
 document.getElementById("lowStockList").innerHTML=low.length?low.map(p=>`<div class="low-item"><strong>${p.name} (${p.kilo})</strong><span>${p.stock} pcs.</span></div>`).join(""):`<div class="low-item"><strong>No low stock items</strong><span>Good</span></div>`;
 document.getElementById("panukliDashboard").textContent=peso(state.panukli);
}
function renderProducts(){
 const tbody=document.getElementById("productsTable");
 tbody.innerHTML=sortedProducts().map(p=>`<tr class="product-row${Number(selectedProductId)===Number(p.id)?" selected-row":""}" data-product-id="${p.id}" tabindex="0"><td>${p.id}</td><td>${escapeHtml(p.supplierName||"—")}</td><td>${escapeHtml(p.supplierAddress||"—")}</td><td>${escapeHtml(p.supplierContact||"—")}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.kilo)}</td><td>${peso(p.dealer)}</td><td>${peso(p.retail)}</td><td>${Number(p.stock)||0} pcs.</td></tr>`).join("") || `<tr><td colspan="9" class="empty-cell">No products available.</td></tr>`;
 tbody.querySelectorAll(".product-row").forEach(row=>{
   const select=()=>selectProduct(Number(row.dataset.productId));
   row.addEventListener("click",select);
   row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select()}});
 });
 updateProductActionButtons();
}
function selectProduct(id){
 const p=state.products.find(x=>Number(x.id)===Number(id));
 if(!p)return;
 selectedProductId=p.id;
 renderProducts();
}
function updateProductActionButtons(){
 const p=state.products.find(x=>Number(x.id)===Number(selectedProductId));
 const editBtn=document.getElementById("editProductBtn"),deleteBtn=document.getElementById("deleteProductBtn");
 if(editBtn)editBtn.disabled=!p;
 if(deleteBtn)deleteBtn.disabled=!p;
}

function renderExpenses(){
 const tbody=document.getElementById("expensesTable");
 const period=document.getElementById("expenseMonth")?.value||"Whole Year";
 const monthIndex={January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
 const currentYear=new Date().getFullYear();
 const rows=[...(state.expenses||[])].filter(e=>{const d=new Date(String(e.date||"")+"T00:00:00");return d.getFullYear()===currentYear&&(period==="Whole Year"||d.getMonth()===monthIndex[period])}).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||Number(b.id||0)-Number(a.id||0));
 const total=rows.reduce((sum,e)=>sum+(Number(e.amount)||0),0);
 const totalLabel=document.getElementById("expenseTotalLabel"),totalValue=document.getElementById("expenseTotalValue");
 if(totalLabel)totalLabel.textContent=`Total Expenses — ${period}`;if(totalValue)totalValue.textContent=peso(total);
 tbody.innerHTML=rows.map(e=>`<tr><td>${e.id}</td><td>${escapeHtml(e.date||"")}</td><td>${escapeHtml(e.description||"")}</td><td>${peso(e.amount)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-cell">No expenses recorded for ${escapeHtml(period)}.</td></tr>`;
}
function renderPurchases(){
 const tbody=document.getElementById("purchasesTable");
 const rows=[...(state.purchases||[])].sort((a,b)=>Number(a.id||0)-Number(b.id||0));
 tbody.innerHTML=rows.map(x=>`<tr><td>${x.id}</td><td>${escapeHtml(x.poNumber||"—")}</td><td>${escapeHtml(x.supplierName||"—")}</td><td>${escapeHtml(x.supplierAddress||"—")}</td><td>${escapeHtml(x.supplierContact||"—")}</td><td>${escapeHtml(x.date||"")}</td><td>${escapeHtml(x.product||"")}</td><td>${Number(x.qty)||0}</td><td>${peso(x.cost)}</td><td><select class="purchase-status-select" data-purchase-id="${x.id}" aria-label="Purchase status"><option value="Pending" ${x.status==="Pending"?"selected":""}>Pending</option><option value="Delivered" ${x.status!=="Pending"?"selected":""}>Delivered</option></select></td></tr>`).join("") || `<tr><td colspan="10" class="empty-cell">No purchases recorded.</td></tr>`;
 tbody.querySelectorAll(".purchase-status-select").forEach(sel=>sel.addEventListener("change",()=>updatePurchaseStatus(Number(sel.dataset.purchaseId),sel.value)));
}
function updatePurchaseStatus(id,newStatus){
 const purchase=state.purchases.find(x=>Number(x.id)===Number(id));if(!purchase)return;
 if(newStatus==="Pending"&&purchase.status==="Delivered"){alert("Hindi na maaaring ibalik sa Pending ang purchase na Delivered na dahil naidagdag na ito sa Inventory.");renderPurchases();return}
 if(newStatus==="Delivered"&&purchase.status!=="Delivered"&&!purchase.stockAdded){
   const match=String(purchase.product||"").match(/^(.*) \((25KG|10KG|5KG|4KG|3KG|2KG|1KG)\)$/i);
   const product=match&&state.products.find(p=>p.name===match[1]&&String(p.kilo).toUpperCase()===match[2].toUpperCase());
   if(!product){alert("Hindi makita ang product para ma-update ang inventory. Walang stock na naidagdag.");renderPurchases();return}
   product.stock+=Number(purchase.qty)||0;purchase.stockAdded=true;
 }
 purchase.status=newStatus;
 if(newStatus==="Pending")purchase.stockAdded=false;
 save();renderAll();
 if(newStatus==="Delivered")alert("Purchase marked as Delivered. Naidagdag na ang quantity sa Inventory.");
}
function transactionKey(x){
 return String(x.transactionId||`${x.invoice||"NO-INVOICE"}|${x.dateTime||x.date||""}|${x.customer||"Walk-in"}`);
}
function groupSalesRows(rows){
 const map=new Map();
 rows.forEach(s=>{
   const key=transactionKey(s);
   if(!map.has(key))map.set(key,{key,items:[],first:s});
   map.get(key).items.push(s);
 });
 return [...map.values()].map(g=>{
   const items=g.items;
   return {...g, id:g.first.id, date:g.first.dateTime||g.first.date||"", invoice:g.first.invoice||"—", customer:g.first.customer||"Walk-in", paymentMode:g.first.paymentMode||"Cash",
     dealer:items.reduce((a,x)=>a+(Number(x.dealer)||0)*(Number(x.qty)||0),0),
     retail:items.reduce((a,x)=>a+(Number(x.retail)||0)*(Number(x.qty)||0),0),
     profit:items.reduce((a,x)=>a+(Number(x.profit)||0),0), total:items.reduce((a,x)=>a+(Number(x.total)||0),0)};
 });
}
function renderSales(){
 const tbody=document.getElementById("salesTable");
 const month=document.getElementById("reportMonth")?.value||"Whole Year";
 const monthIndex={January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
 const rows=(state.sales||[]).filter(s=>{
   if(month==="Whole Year")return true;
   const d=new Date(String(s.date||"")+"T00:00:00");
   return !Number.isNaN(d.getTime())&&d.getMonth()===monthIndex[month];
 });
 const isAdmin=state.user?.role==="ADMIN";
 const groups=groupSalesRows(rows).sort((a,b)=>Number(b.id||0)-Number(a.id||0));
 const revenue=groups.reduce((sum,s)=>sum+Number(s.total||0),0);
 const profit=groups.reduce((sum,s)=>sum+Number(s.profit||0),0);
 document.getElementById("reportTransactions").textContent=groups.length;
 document.getElementById("reportRevenue").textContent=peso(revenue);
 document.getElementById("reportProfit").textContent=peso(profit);
 const dealerHeader=document.querySelector("#reports thead th.report-dealer-price");
 if(dealerHeader)dealerHeader.hidden=!isAdmin;
 tbody.innerHTML=groups.map(g=>`<tr class="sales-row" data-sales-key="${encodeURIComponent(g.key)}" title="Double-click to view purchased items"><td>${g.id}</td><td>${escapeHtml(g.date)}</td><td>${escapeHtml(g.invoice)}</td><td>${escapeHtml(g.customer)}</td><td>${escapeHtml(g.paymentMode)}</td>${isAdmin?`<td class="report-dealer-price">${peso(g.dealer)}</td>`:""}<td>${peso(g.retail)}</td><td>${peso(g.profit)}</td><td>${peso(g.total)}</td></tr>`).join("") || `<tr><td colspan="${isAdmin?9:8}" class="empty-cell">No sales found for the selected period.</td></tr>`;
 tbody.querySelectorAll(".sales-row").forEach(row=>row.addEventListener("dblclick",()=>openSalesDetails(decodeURIComponent(row.dataset.salesKey))));
}
function openSalesDetails(key){
 const items=(state.sales||[]).filter(s=>transactionKey(s)===key);
 if(!items.length)return;
 const first=items[0];
 openModal(`Sales Invoice ${first.invoice||"—"}`,`${first.customer||"Walk-in"} • ${first.dateTime||first.date||""}`,`<div class="detail-table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${items.map(x=>`<tr><td>${escapeHtml(x.product||`${x.name||""} (${x.kilo||""})`)}</td><td>${Number(x.qty)||0}</td><td>${peso(x.retail)}</td><td>${peso(x.total)}</td></tr>`).join("")}</tbody></table></div><div class="detail-total"><span>Total</span><strong>${peso(items.reduce((a,x)=>a+(Number(x.total)||0),0))}</strong></div>`);
}
function renderInventory(){
 document.getElementById("inventoryTable").innerHTML=sortedProducts().map(p=>{const low=(Number(p.stock)||0)<=(Number(p.min)||0);return `<tr><td>${p.id}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.kilo)}</td><td>${Number(p.stock)||0} pcs.</td><td>${peso((Number(p.stock)||0)*(Number(p.dealer)||0))}</td><td class="stock-status ${low?"low-stock":"sufficient-stock"}">${low?"Low Stock":"Sufficient Stock"}</td></tr>`}).join("") || `<tr><td colspan="6" class="empty-cell">No inventory available.</td></tr>`;
}
function renderCustomers(){
 const tbody=document.getElementById("customersTable");
 tbody.innerHTML=state.customers.map(c=>`<tr class="customer-row${Number(window.selectedCustomerId)===Number(c.id)?" selected-row":""}" data-customer-id="${c.id}" tabindex="0"><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.contact||"—")}</td><td>${escapeHtml(c.address||"—")}</td><td>${escapeHtml(c.storeName||"—")}</td><td>${peso(c.balance)}</td><td class="center">${c.kg25||0}</td><td class="center">${c.kg10||0}</td><td class="center">${c.kg5||0}</td></tr>`).join("") || `<tr><td colspan="8" class="empty-cell">No customers found.</td></tr>`;
 tbody.querySelectorAll(".customer-row").forEach(row=>row.addEventListener("click",()=>selectCustomer(Number(row.dataset.customerId))));
 updateCustomerActionButtons();
 const dl=document.getElementById("customerOptions");dl.innerHTML=state.customers.map(c=>`<option value="${escapeHtml(c.name)}"></option>`).join("");
}
function selectCustomer(id){window.selectedCustomerId=id;renderCustomers()}
function updateCustomerActionButtons(){
 const c=state.customers.find(x=>Number(x.id)===Number(window.selectedCustomerId));
 const exists=!!c;
 const hasBalance=exists && (Number(c.balance)||0)>0;
 const e=document.getElementById("editCustomerBtn"),d=document.getElementById("deleteCustomerBtn");
 const h=document.getElementById("paymentHistoryBtn"),r=document.getElementById("recordPaymentBtn");
 if(e)e.disabled=!exists;
 if(d)d.disabled=!exists;
 // Payment History can be viewed even when the balance is already zero.
 if(h)h.disabled=!exists;
 // Record Payment is available only when the selected customer still has an outstanding balance.
 if(r)r.disabled=!hasBalance;
}
function orderGroupKey(o){return String(o.transactionId||`${o.invoice||"NO-INVOICE"}|${o.date||""}|${o.customer||"Walk-in"}`)}
function groupOrders(rows){
 const map=new Map();rows.forEach(o=>{const k=orderGroupKey(o);if(!map.has(k))map.set(k,[]);map.get(k).push(o)});
 return [...map.entries()].map(([key,items])=>({key,items,first:items[0],id:items[0].id,date:items[0].date,customer:items[0].customer||"Walk-in",address:items[0].address||"—",contact:items[0].contact||"—",invoice:items[0].invoice||"—",processedBy:items[0].processedBy||"—",delivered:items.every(x=>x.delivered===true),deliveredDate:items.find(x=>x.deliveredDate)?.deliveredDate||"",deliveredBy:items.find(x=>x.deliveredBy)?.deliveredBy||""}));
}
function renderOrders(){
 const pending=groupOrders(state.orders.filter(o=>o.delivered!==true&&o.status!=="Delivered"));
 const tbody=document.getElementById("ordersTable");
 tbody.innerHTML=pending.map(g=>`<tr class="order-row" data-order-key="${encodeURIComponent(g.key)}" title="Double-click Sales Invoice to view products"><td>${g.id}</td><td>${escapeHtml(g.date)}</td><td>${escapeHtml(g.customer)}</td><td>${escapeHtml(g.address)}</td><td>${escapeHtml(g.contact)}</td><td class="invoice-cell">${escapeHtml(g.invoice)}</td><td><span class="status-badge pending">Pending</span></td><td>${escapeHtml(g.processedBy)}</td><td><button class="primary-btn order-deliver-btn" onclick="markOrderDelivered('${encodeURIComponent(g.key)}')">Mark Delivered</button></td></tr>`).join("")||`<tr><td colspan="9" class="empty-cell">No pending delivery orders.</td></tr>`;
 tbody.querySelectorAll(".order-row").forEach(row=>row.addEventListener("dblclick",()=>openOrderDetails(decodeURIComponent(row.dataset.orderKey))));
}
function openOrderDetails(key){
 const items=state.orders.filter(o=>orderGroupKey(o)===key);if(!items.length)return;
 const first=items[0];
 openModal(`Order ${first.invoice||"—"}`,`${first.customer||"Walk-in"} • ${first.date||""}`,`<div class="detail-table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Status</th></tr></thead><tbody>${items.map(x=>`<tr><td>${escapeHtml(x.product||"")}</td><td>${Number(x.qty)||0}</td><td>${x.delivered===true?"Delivered":"Pending"}</td></tr>`).join("")}</tbody></table></div>`);
}
function renderDeliveryHistory(){
 const delivered=groupOrders(state.orders.filter(o=>o.delivered===true||o.status==="Delivered")).sort((a,b)=>Number(b.id||0)-Number(a.id||0));
 const headers=["Date","Sales Invoice","Customer","Delivered Date","Delivered By"];
 const rows=delivered.map(g=>[g.date||"",g.invoice||"—",g.customer||"Walk-in",g.deliveredDate||"—",g.deliveredBy||"—"]);
 const tableRows=rows.map(r=>`<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td><td>${escapeHtml(r[2])}</td><td>${escapeHtml(r[3])}</td><td>${escapeHtml(r[4])}</td></tr>`).join("");
 openModal("Delivery History",`${delivered.length} completed order${delivered.length===1?"":"s"}`,`<div class="delivery-history-content"><div class="button-group delivery-history-actions"><button type="button" id="deliveryHistoryCSV" class="primary-btn">Print to CSV</button><button type="button" id="deliveryHistoryPDF" class="primary-btn secondary-btn">Print to PDF</button></div><div class="detail-table-wrap delivery-history-table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${tableRows||`<tr><td colspan="5" class="empty-cell">No completed deliveries found.</td></tr>`}</tbody></table></div></div>`);
 document.getElementById("deliveryHistoryCSV")?.addEventListener("click",()=>{const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");downloadText(`JAT-Delivery-History-${todayISO()}.csv`,csv,"text/csv;charset=utf-8")});
 document.getElementById("deliveryHistoryPDF")?.addEventListener("click",()=>{const w=window.open("","_blank","width=1200,height=800");if(!w){alert("Please allow pop-ups to print/save the Delivery History PDF.");return}w.document.write(`<html><head><title>JAT Delivery History ${todayISO()}</title><style>body{font-family:Arial;padding:24px}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #999;padding:8px;text-align:left;font-size:12px}th{background:#eee}</style></head><body><h1>JAT Golden Grains Trading</h1><div>Delivery History — ${dateLabel()}</div><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${tableRows||`<tr><td colspan="5">No completed deliveries found.</td></tr>`}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()});
}

function markOrderDelivered(encodedKey){
 const key=decodeURIComponent(encodedKey),items=state.orders.filter(o=>orderGroupKey(o)===key&&o.delivered!==true);if(!items.length)return;
 if(!confirm(`Mark Sales Invoice ${items[0].invoice||"—"} as Delivered? This will record the completed sale in Reports.`))return;
 const customerName=items[0].customer||"Walk-in";
 let c=state.customers.find(x=>x.name.trim().toLowerCase()===customerName.trim().toLowerCase());
 let saleId=state.sales.length?Math.max(...state.sales.map(s=>Number(s.id)||0))+1:1;
 items.forEach(order=>{
   const qty=Number(order.qty)||0,retail=Number(order.retail)||0,dealer=Number(order.dealer)||0,totalItem=qty*retail,profit=Number(order.profit)||qty*(retail-dealer);
   if(c){if(order.paymentMode==="Utang")c.balance=(Number(c.balance)||0)+totalItem;const m=String(order.product||"").match(/\((25KG|10KG|5KG)\)$/i)?.[1]?.toUpperCase();if(m==="25KG")c.kg25=(c.kg25||0)+qty;if(m==="10KG")c.kg10=(c.kg10||0)+qty;if(m==="5KG")c.kg5=(c.kg5||0)+qty;}
   state.sales.push({id:saleId++,transactionId:order.transactionId||key,date:todayISO(),dateTime:dateTimeLabel(),customer:customerName,contact:order.contact||"",address:order.address||"",invoice:order.invoice||"",product:order.product,qty,dealer,retail,profit,total:totalItem,status:"Delivered",paymentMode:order.paymentMode||"Cash",user:order.processedBy||state.user.name});
   order.status="Delivered";order.delivered=true;order.deliveredDate=dateTimeLabel();order.deliveredBy=state.user.name;
 });
 save();renderAll();alert(`Sales Invoice ${items[0].invoice||"—"} has been marked as Delivered and recorded in Reports.`);
}

function populatePOS(){
 const sel=document.getElementById("posProduct");
 if(!sel)return;
 const products=Array.isArray(state.products)?sortedProducts().filter(p=>p&&String(p.name||"").trim()):[];
 sel.innerHTML="";
 if(products.length){
   products.forEach(p=>{
     const option=document.createElement("option");
     option.value=String(p.id);
     option.textContent=`${p.name}${p.kilo?` (${p.kilo})`:""} — ${Number(p.stock)||0} pcs.`;
     sel.appendChild(option);
   });
   sel.disabled=false;
   sel.selectedIndex=0;
 }else{
   const option=document.createElement("option");
   option.value="";
   option.textContent="No products available";
   sel.appendChild(option);
   sel.disabled=true;
 }
 updatePOSPrice();
 renderCart();
}
function updatePOSPrice(){const p=state.products.find(x=>x.id==document.getElementById("posProduct").value);if(p){document.getElementById("posPrice").value=p.retail;updatePOSTotal()}}
function cartTotal(){return state.cart.reduce((sum,item)=>sum+(Number(item.qty)||0)*(Number(item.price)||0),0)}
function updatePOSTotal(){const total=cartTotal();document.getElementById("posTotal").textContent=peso(total);updateChange()}
function updateChange(){const total=cartTotal(),cash=Number(document.getElementById("posCashReceived").value||0);document.getElementById("posChange").textContent=peso(Math.max(0,cash-total))}
function renderCart(){
 const tbody=document.getElementById("posCartTable"),note=document.getElementById("cartEmptyNote");
 tbody.innerHTML=state.cart.length?state.cart.map((item,i)=>`<tr><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.kilo)}</small></td><td>${item.qty}</td><td>${peso(item.price)}</td><td>${peso(item.qty*item.price)}</td><td><button class="cart-remove" onclick="removeFromCart(${i})">Remove</button></td></tr>`).join(""):"";
 if(note)note.hidden=state.cart.length>0;
 const wrap=document.querySelector(".cart-table-wrap");if(wrap)wrap.classList.toggle("has-items",state.cart.length>0);
 updatePOSTotal();
}
function addToCart(){
 const p=state.products.find(x=>x.id==document.getElementById("posProduct").value),qty=Number(document.getElementById("posQty").value),price=Number(document.getElementById("posPrice").value);
 if(!p||!Number.isInteger(qty)||qty<1||!Number.isFinite(price)||price<0){showPOSMessage("Please complete the product, quantity and price fields.",true);return}
 const existingQty=state.cart.filter(x=>x.productId===p.id).reduce((a,x)=>a+x.qty,0);
 if(existingQty+qty>p.stock){showPOSMessage(`Hindi sapat ang stock. Available: ${p.stock} pcs.`,true);return}
 const existing=state.cart.find(x=>x.productId===p.id);
 if(existing){existing.qty+=qty;existing.price=price}else state.cart.push({productId:p.id,name:p.name,kilo:p.kilo,qty,price});
 renderCart();document.getElementById("posQty").value=1;showPOSMessage(`${p.name} (${p.kilo}) added to cart.`);updatePOSPrice();
}
function removeFromCart(index){state.cart.splice(index,1);renderCart();showPOSMessage("Product removed from cart.")}
function fillCustomerDetails(){
 const input=document.getElementById("posCustomer"),name=input.value.trim().toLowerCase(),c=state.customers.find(x=>x.name.trim().toLowerCase()===name);
 document.getElementById("posContact").value=c?c.contact||"":"";document.getElementById("posAddress").value=c?c.address||"":"";
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
document.getElementById("posProduct").addEventListener("change",updatePOSPrice);
document.getElementById("posQty").addEventListener("input",()=>{});
document.getElementById("posPrice").addEventListener("input",()=>{});
document.getElementById("posCashReceived").addEventListener("input",updateChange);
document.getElementById("posCustomer").addEventListener("change",fillCustomerDetails);
document.getElementById("posCustomer").addEventListener("blur",fillCustomerDetails);
document.getElementById("addToCart").addEventListener("click",addToCart);
document.getElementById("posPaymentMode").addEventListener("change",()=>{const cash=document.getElementById("posPaymentMode").value==="Cash";document.getElementById("cashFields").classList.toggle("disabled-field",!cash);document.getElementById("posCashReceived").disabled=!cash;updateChange()});
document.getElementById("reportMonth").addEventListener("change",renderSales);

document.getElementById("processSale").addEventListener("click",()=>{
 const status=document.getElementById("posStatus").value,paymentMode=document.getElementById("posPaymentMode").value,customer=document.getElementById("posCustomer").value.trim(),contact=document.getElementById("posContact").value.trim(),address=document.getElementById("posAddress").value.trim(),invoice=document.getElementById("posInvoice").value.trim(),total=cartTotal();
 if(!state.cart.length){showPOSMessage("Please add at least one product to the cart.",true);return}
 const normalizedInvoice=invoice.trim().toLowerCase();
 if(normalizedInvoice){
   const duplicateInvoice=[...(state.sales||[]),...(state.orders||[])].some(x=>String(x.invoice||"").trim().toLowerCase()===normalizedInvoice);
   if(duplicateInvoice){
     const proceed=confirm(`Ang Sales Invoice "${invoice}" ay mayroon nang kaparehong record.\n\nGusto mo bang ituloy ang sale gamit ang parehong Sales Invoice?\n\nOK = Ituloy\nCancel = Huwag ituloy`);
     if(!proceed){showPOSMessage("Sale cancelled dahil duplicate ang Sales Invoice.",true);return}
   }
 }
 if(status==="For Delivery"&&(!customer||!address||!contact)){showPOSMessage("For Delivery requires Customer's Name, Contact No. and Address.",true);return}
 let cashReceived=0,changeDue=0;if(paymentMode==="Cash"){cashReceived=Number(document.getElementById("posCashReceived").value||0);changeDue=Math.max(0,cashReceived-total);if(cashReceived<total){showPOSMessage("Insufficient cash received for this sale.",true);return}if(changeDue>Number(state.panukli||0)){showPOSMessage(`Kulang ang Panukli Fund. Kailangan: ${peso(changeDue)}; available: ${peso(state.panukli)}. Magdagdag muna ng Panukli Fund.`,true);return}}
 for(const item of state.cart){const p=state.products.find(x=>x.id===item.productId);if(!p||item.qty<1||p.stock<item.qty){showPOSMessage(`Hindi sapat ang stock para sa ${item.name} (${item.kilo}).`,true);return}}
 let c=state.customers.find(x=>x.name.trim().toLowerCase()===customer.toLowerCase());
 if(customer&&customer.toLowerCase()!=="walk-in"&&customer.toLowerCase()!=="walk-in customer"&&!c){const id=state.customers.length?Math.max(...state.customers.map(x=>x.id||0))+1:1;c={id,name:customer,contact,address,storeName:"",balance:0,kg25:0,kg10:0,kg5:0};state.customers.push(c)} else if(c){c.contact=contact||c.contact;c.address=address||c.address}
 const transactionId=`TX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
 let saleIdBase=state.sales.length?Math.max(...state.sales.map(s=>Number(s.id)||0))+1:1,orderIdBase=state.orders.length?Math.max(...state.orders.map(o=>Number(o.id)||0))+1:1;
 state.cart.forEach((item,index)=>{
   const p=state.products.find(x=>x.id===item.productId),qty=item.qty,retail=item.price,totalItem=qty*retail,profit=qty*(retail-p.dealer);p.stock-=qty;const productName=`${p.name} (${p.kilo})`;
   if(status==="For Delivery")state.orders.push({id:orderIdBase+index,transactionId,date:dateTimeLabel(),customer:customer||"Walk-in",contact,address,invoice,product:productName,qty,status:"Pending",processedBy:state.user.name,delivered:false,dealer:p.dealer,retail,paymentMode,total:totalItem,profit});
   else{if(c){if(paymentMode==="Utang")c.balance=(Number(c.balance)||0)+totalItem; if(p.kilo==="25KG")c.kg25=(c.kg25||0)+qty;if(p.kilo==="10KG")c.kg10=(c.kg10||0)+qty;if(p.kilo==="5KG")c.kg5=(c.kg5||0)+qty}state.sales.push({id:saleIdBase+index,transactionId,date:todayISO(),dateTime:dateTimeLabel(),customer:customer||"Walk-in",contact,address,invoice,product:productName,qty,dealer:p.dealer,retail,profit,total:totalItem,status:"For Pickup",paymentMode,user:state.user.name})}
 });
 if(paymentMode==="Cash"&&changeDue>0)state.panukli=Math.max(0,Number(state.panukli||0)-changeDue);state.cart=[];save();renderAll();document.getElementById("posCustomer").value="";document.getElementById("posContact").value="";document.getElementById("posAddress").value="";document.getElementById("posInvoice").value="";document.getElementById("posStatus").value="For Pickup";document.getElementById("posPaymentMode").value="Cash";document.getElementById("cashFields").classList.remove("disabled-field");document.getElementById("posCashReceived").disabled=false;document.getElementById("posMessage").textContent=status==="For Delivery"?"Order added to Customer's Order as Pending. It will appear in Reports after Delivered.":"Sale successfully processed.";document.getElementById("posQty").value=1;document.getElementById("posCashReceived").value="";renderCart();updatePOSPrice();
});
function showPOSMessage(msg,error=false){const el=document.getElementById("posMessage");el.textContent=msg;el.className=error?"error":"success"}

function validateProductValues(name,kilo,dealer,retail,stock,min=10,supplierName="",supplierAddress="",supplierContact=""){
 const cleanName=String(name||"").trim(),cleanKilo=String(kilo||"").trim().toUpperCase();
 if(!cleanName){alert("Product name is required.");return null}
 if(!["25KG","10KG","5KG","4KG","3KG","2KG","1KG"].includes(cleanKilo)){alert("Pumili ng valid na KILO size.");return null}
 if(!Number.isFinite(dealer)||dealer<0||!Number.isFinite(retail)||retail<0||!Number.isFinite(stock)||stock<0||!Number.isFinite(min)||min<0){alert("Dealer Price, Retail Price, Stock and Buffer must be valid non-negative numbers.");return null}
 return {name:cleanName,kilo:cleanKilo,dealer,retail,stock,min,supplierName:String(supplierName||"").trim(),supplierAddress:String(supplierAddress||"").trim(),supplierContact:String(supplierContact||"").trim()};
}
function productFormHtml(p={name:"",kilo:"25KG",dealer:0,retail:0,stock:0,min:10,supplierName:"",supplierAddress:"",supplierContact:""}){
 const suppliers=[...new Set(state.products.map(x=>String(x.supplierName||"").trim()).filter(Boolean))];
 const sizes=["25KG","10KG","5KG","4KG","3KG","2KG","1KG"];
 return `<form id="productForm" class="modal-form product-modal-form"><div class="form-grid modal-form-grid product-modal-grid"><div><label>Supplier Name</label><input id="modalSupplierName" list="supplierOptions" value="${escapeHtml(p.supplierName||"")}" autocomplete="off"><datalist id="supplierOptions">${suppliers.map(n=>`<option value="${escapeHtml(n)}"></option>`).join("")}</datalist></div><div><label>Supplier Address</label><input id="modalSupplierAddress" value="${escapeHtml(p.supplierAddress||"")}"></div><div><label>Supplier Contact No.</label><input id="modalSupplierContact" value="${escapeHtml(p.supplierContact||"")}"></div><div><label>Product</label><input id="modalProductName" required value="${escapeHtml(p.name)}"></div><div><label>KILO</label><select id="modalProductKilo">${sizes.map(k=>`<option value="${k}" ${String(p.kilo).toUpperCase()===k?"selected":""}>${k}</option>`).join("")}</select></div><div><label>Dealer Price</label><input id="modalDealer" type="number" min="0" step="0.01" required value="${Number(p.dealer)||0}"></div><div><label>Retail Price</label><input id="modalRetail" type="number" min="0" step="0.01" required value="${Number(p.retail)||0}"></div><div><label>Stock</label><input id="modalStock" type="number" min="0" step="1" required value="${Number(p.stock)||0}"></div><div><label>Buffer</label><input id="modalMin" type="number" min="0" step="1" required value="${Number(p.min)||0}"></div></div><div class="modal-actions"><button type="button" class="primary-btn secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" type="submit">Save</button></div></form>`;
}
function addProduct(){
 if(!requireAdmin("add products"))return;
 openModal("Add Product","Enter all product details.",productFormHtml());
 document.getElementById("productForm").addEventListener("submit",e=>{e.preventDefault();saveProductFromModal(null)});
}
function editProduct(id=selectedProductId){
 if(!requireAdmin("edit products"))return;
 const p=state.products.find(x=>Number(x.id)===Number(id));if(!p){alert("Pumili muna ng product sa table.");return}
 openModal("Edit Product","All editable product details are shown below.",productFormHtml(p));
 document.getElementById("productForm").addEventListener("submit",e=>{e.preventDefault();saveProductFromModal(p)});
}
function saveProductFromModal(existing){
 const values=validateProductValues(document.getElementById("modalProductName").value,document.getElementById("modalProductKilo").value,Number(document.getElementById("modalDealer").value),Number(document.getElementById("modalRetail").value),Number(document.getElementById("modalStock").value),Number(document.getElementById("modalMin").value),document.getElementById("modalSupplierName").value,document.getElementById("modalSupplierAddress").value,document.getElementById("modalSupplierContact").value);if(!values)return;
 const duplicate=state.products.find(x=>Number(x.id)!==Number(existing?.id)&&x.name.trim().toLowerCase()===values.name.toLowerCase()&&String(x.kilo).toUpperCase()===values.kilo);if(duplicate){alert(`Mayroon nang kaparehong product: ${duplicate.name} (${duplicate.kilo}).`);return}
 if(existing){Object.assign(existing,values);selectedProductId=existing.id}else{const id=state.products.length?Math.max(...state.products.map(p=>Number(p.id)||0))+1:1;state.products.push({id,...values});selectedProductId=id}
 save();closeModal();renderAll();
}
function deleteProduct(id=selectedProductId){
 if(!requireAdmin("delete products"))return;
 const p=state.products.find(x=>Number(x.id)===Number(id));if(!p){alert("Pumili muna ng product sa table.");return}
 if(state.cart.some(item=>Number(item.productId)===Number(p.id))){alert("Hindi maaaring i-delete ang product habang nasa Cart ito. Alisin muna ito sa Cart.");return}
 if(!confirm(`Delete product "${p.name} (${p.kilo})"?\n\nThis action cannot be undone.`))return;
 state.products=state.products.filter(x=>Number(x.id)!==Number(p.id));selectedProductId=null;save();renderAll();
}

document.getElementById("addProductBtn").addEventListener("click",addProduct);
document.getElementById("editProductBtn").addEventListener("click",()=>editProduct());
document.getElementById("deleteProductBtn").addEventListener("click",()=>deleteProduct());

function customerFormHtml(c={name:"",contact:"",address:"",storeName:""}){
 return `<form id="customerForm" class="modal-form"><div class="modal-form-grid single"><div><label>Customer's Name</label><input id="modalCustomerName" required value="${escapeHtml(c.name)}"></div><div><label>Address</label><input id="modalCustomerAddress" value="${escapeHtml(c.address)}"></div><div><label>Contact No.</label><input id="modalCustomerContact" value="${escapeHtml(c.contact)}"></div><div><label>Store Name</label><input id="modalCustomerStore" value="${escapeHtml(c.storeName)}"></div></div><div class="modal-actions"><button type="button" class="primary-btn secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" type="submit">Save</button></div></form>`;
}
function recordCustomerPayment(){
 const c=state.customers.find(x=>Number(x.id)===Number(window.selectedCustomerId));
 if(!c){alert("Pumili muna ng customer sa table.");return}
 const balance=Number(c.balance)||0;
 if(balance<=0){alert("Walang natitirang balance ang customer na ito.");return}
 openModal("Record Payment",`Record balance payment for ${escapeHtml(c.name)}.`, `<form id="paymentForm" class="modal-form"><div class="modal-form-grid single"><div><label>Customer's Name</label><input value="${escapeHtml(c.name)}" readonly></div><div><label>Current Balance</label><input value="${peso(balance)}" readonly></div><div><label>Amount Paid</label><input id="paymentAmount" type="number" min="0.01" max="${balance}" step="0.01" required placeholder="0.00"></div><div><label>Received By</label><input id="paymentReceivedBy" value="${escapeHtml(state.user?.name||"")}" required></div></div><div class="modal-actions"><button type="button" class="primary-btn secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" type="submit">Save Payment</button></div></form>`);
 document.getElementById("paymentForm").addEventListener("submit",e=>{
   e.preventDefault(); const amount=Number(document.getElementById("paymentAmount").value)||0; const receivedBy=document.getElementById("paymentReceivedBy").value.trim()||state.user?.name||"";
   if(amount<=0||amount>balance){alert(`Ang payment ay dapat nasa ₱0.01 hanggang ${peso(balance)}.`);return}
   const remaining=Math.max(0,balance-amount); const id=state.payments.length?Math.max(...state.payments.map(x=>Number(x.id)||0))+1:1;
   state.payments.push({id,customerId:c.id,customer:c.name,dateTime:dateTimeLabel(),amount,receivedBy,balanceAfter:remaining}); c.balance=remaining; save(); closeModal(); renderAll(); selectCustomer(c.id); alert(`Payment recorded. Remaining balance: ${peso(remaining)}`);
 });
}
function showPaymentHistory(){
 const c=state.customers.find(x=>Number(x.id)===Number(window.selectedCustomerId)); if(!c){alert("Pumili muna ng customer sa table.");return}
 const rows=state.payments.filter(p=>Number(p.customerId)===Number(c.id)).sort((a,b)=>Number(b.id||0)-Number(a.id||0));
 openModal("Payment History",`${escapeHtml(c.name)} • Current Balance: ${peso(c.balance)}`,`<div class="detail-table-wrap"><table><thead><tr><th>Date & Time</th><th>Amount Paid</th><th>Received By</th><th>Balance After Payment</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${escapeHtml(p.dateTime||"—")}</td><td>${peso(p.amount)}</td><td>${escapeHtml(p.receivedBy||"—")}</td><td>${peso(p.balanceAfter)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty-cell">No payment history yet.</td></tr>`}</tbody></table></div><div class="detail-total"><span>Current Balance</span><strong>${peso(c.balance)}</strong></div>`);
}
function clearDatabase(){
 alert("Naka-disable muna ang Clear Database habang inililipat ang data sa Firebase, para maiwasan ang aksidenteng pagbura ng shared data.");return;
 /* Deliberately disabled during Firebase migration. */
 if(state.user?.role!=="ADMIN"){alert("ADMIN access only.");return}
 const password=prompt("ADMIN ONLY\nEnter your admin password to continue:");
 if(password===null)return;
 if(!confirm("WARNING: This will permanently clear ALL business data including Products, Customers, Sales, Orders, Expenses, Purchases, Payment History, and Cart.\n\nContinue?"))return;
 if(!confirm("FINAL CONFIRMATION: Clear the entire database now? This cannot be undone."))return;
 state.products=[];state.customers=[];state.sales=[];state.orders=[];state.expenses=[];state.purchases=[];state.payments=[];state.cart=[];state.panukli=0;window.selectedCustomerId=null;selectedProductId=null;save();renderAll();alert("Database cleared successfully.");
}
function addCustomer(){openModal("Add Customer","Enter the customer's details.",customerFormHtml());document.getElementById("customerForm").addEventListener("submit",e=>{e.preventDefault();saveCustomerFromModal(null)})}
function editCustomer(){
 const c=state.customers.find(x=>Number(x.id)===Number(window.selectedCustomerId));if(!c){alert("Pumili muna ng customer sa table.");return}
 openModal("Edit Customer","Update all customer details in one window.",customerFormHtml(c));document.getElementById("customerForm").addEventListener("submit",e=>{e.preventDefault();saveCustomerFromModal(c)})
}
function saveCustomerFromModal(existing){
 const name=document.getElementById("modalCustomerName").value.trim();if(!name||/walk-in/i.test(name)){alert("Please enter a valid customer name.");return}
 const data={name,contact:document.getElementById("modalCustomerContact").value.trim(),address:document.getElementById("modalCustomerAddress").value.trim(),storeName:document.getElementById("modalCustomerStore").value.trim()};
 const dup=state.customers.find(x=>Number(x.id)!==Number(existing?.id)&&x.name.trim().toLowerCase()===name.toLowerCase());if(dup){alert("Mayroon nang customer na may ganitong pangalan.");return}
 if(existing)Object.assign(existing,data);else{const id=state.customers.length?Math.max(...state.customers.map(c=>c.id||0))+1:1;state.customers.push({id,...data,balance:0,kg25:0,kg10:0,kg5:0});window.selectedCustomerId=id}
 save();closeModal();renderAll();
}
function deleteCustomer(){
 const c=state.customers.find(x=>Number(x.id)===Number(window.selectedCustomerId));if(!c)return;
 if(!confirm(`Delete customer "${c.name}"?`))return;
 state.customers=state.customers.filter(x=>Number(x.id)!==Number(c.id));window.selectedCustomerId=null;save();renderAll();
}
document.getElementById("addCustomerBtn").addEventListener("click",addCustomer);
document.getElementById("editCustomerBtn").addEventListener("click",editCustomer);
document.getElementById("deleteCustomerBtn").addEventListener("click",deleteCustomer);
document.getElementById("paymentHistoryBtn").addEventListener("click",showPaymentHistory);
document.getElementById("recordPaymentBtn").addEventListener("click",recordCustomerPayment);
document.getElementById("clearDatabaseBtn").addEventListener("click",clearDatabase);
document.getElementById("deliveryHistoryBtn").addEventListener("click",renderDeliveryHistory);

document.getElementById("addPanukliBtn").addEventListener("click",()=>{const amount=Number(prompt("Halagang idaragdag sa Panukli:","0"));if(!Number.isFinite(amount)||amount<=0)return;state.panukli+=amount;save();renderAll();alert(`Nadagdagan ang Panukli ng ${peso(amount)}.\nKabuuang Panukli: ${peso(state.panukli)}`)});

document.getElementById("expenseMonth").addEventListener("change",renderExpenses);
document.getElementById("addExpenseBtn").addEventListener("click",()=>{const description=prompt("Expense description:");if(!description)return;const amount=Number(prompt("Amount:","0"));if(amount<0)return;const id=state.expenses.length?Math.max(...state.expenses.map(e=>e.id))+1:1;state.expenses.push({id,date:todayISO(),description,amount});save();renderAll()});
document.getElementById("addPurchaseBtn").addEventListener("click",()=>{
 if(!requireAdmin("add purchases"))return;
 if(!state.products.length){alert("Add a product first before recording a purchase.");return}
 const suppliers=[...new Set(state.products.map(p=>String(p.supplierName||"").trim()).filter(Boolean))];
 const products=sortedProducts();
 openModal("Add Purchase","Pending purchases will not increase Inventory until marked Delivered.",`<form id="purchaseForm" class="modal-form"><div class="form-grid modal-form-grid purchase-modal-grid"><div><label>PO Number</label><input id="purchasePONumber" required placeholder="Enter PO Number"></div><div><label>Supplier Name</label><input id="purchaseSupplier" list="purchaseSupplierOptions" required><datalist id="purchaseSupplierOptions">${suppliers.map(n=>`<option value="${escapeHtml(n)}"></option>`).join("")}</datalist></div><div><label>Product</label><select id="purchaseProduct">${products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${p.kilo})</option>`).join("")}</select></div><div><label>Quantity</label><input id="purchaseQty" type="number" min="1" step="1" value="1" required></div><div><label>Status</label><select id="purchaseStatus"><option value="Pending" selected>Pending</option><option value="Delivered">Delivered</option></select></div></div><div class="modal-actions purchase-modal-actions"><button type="button" class="primary-btn secondary-btn" data-modal-close>Cancel</button><button type="button" id="generatePOFormBtn" class="primary-btn secondary-btn">Generate PO Form</button><button class="primary-btn" type="submit">Save Purchase</button></div></form>`);
 document.getElementById("generatePOFormBtn").addEventListener("click",generatePurchasePOForm);
 document.getElementById("purchaseForm").addEventListener("submit",e=>{
   e.preventDefault();const p=state.products.find(x=>Number(x.id)===Number(document.getElementById("purchaseProduct").value)),qty=Number(document.getElementById("purchaseQty").value),poNumber=document.getElementById("purchasePONumber").value.trim(),supplierName=document.getElementById("purchaseSupplier").value.trim(),status=document.getElementById("purchaseStatus").value;
   if(!p||!poNumber||!supplierName||!Number.isInteger(qty)||qty<1){alert("Pakikumpleto ang PO Number, Supplier Name, Product at valid na Quantity.");return}
   if(state.purchases.some(x=>String(x.poNumber||"").trim().toLowerCase()===poNumber.toLowerCase())){alert("May existing purchase na may ganitong PO Number.");return}
   const id=state.purchases.length?Math.max(...state.purchases.map(x=>Number(x.id)||0))+1:1;
   const purchase={id,poNumber,status,date:todayISO(),product:`${p.name} (${p.kilo})`,qty,cost:qty*p.dealer,supplierName,supplierAddress:p.supplierName===supplierName?(p.supplierAddress||""):"",supplierContact:p.supplierName===supplierName?(p.supplierContact||""):"",stockAdded:status==="Delivered"};
   if(status==="Delivered")p.stock+=qty;
   state.purchases.push(purchase);save();closeModal();renderAll();
 });
});


function generatePurchasePOForm(){
 const poNumber=document.getElementById("purchasePONumber")?.value.trim();
 const supplierName=document.getElementById("purchaseSupplier")?.value.trim();
 const productId=document.getElementById("purchaseProduct")?.value;
 const qty=Number(document.getElementById("purchaseQty")?.value);
 const product=state.products.find(p=>Number(p.id)===Number(productId));
 if(!poNumber||!supplierName||!product||!Number.isInteger(qty)||qty<1){alert("Pakikumpleto muna ang PO Number, Supplier Name, Product at valid na Quantity bago gumawa ng PO Form.");return}
 const supplierProduct=state.products.find(p=>String(p.supplierName||"").trim().toLowerCase()===supplierName.toLowerCase());
 const address=supplierProduct?.supplierAddress||"";
 const contact=supplierProduct?.supplierContact||"";
 const unitCost=Number(product.dealer)||0;
 const total=unitCost*qty;
 const w=window.open("","_blank","width=950,height=800");
 if(!w){alert("Pakipahintulutan ang pop-ups para makagawa ng Purchase Order PDF.");return}
 const safe=(value)=>escapeHtml(String(value??""));
 w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Purchase Order ${safe(poNumber)}</title><style>
 @page{size:A4 portrait;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1d2b28;margin:0;font-size:12px}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #176b50;padding-bottom:16px;margin-bottom:22px}.brand{font-size:21px;font-weight:800;color:#176b50}.muted{color:#63716d;font-size:11px;margin-top:5px}.po-title{text-align:right}.po-title h1{font-size:26px;margin:0 0 7px;letter-spacing:1px}.po-number{font-size:14px;font-weight:bold}.details{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:24px}.panel{border:1px solid #ccd8d3;border-radius:5px;padding:12px;min-height:92px}.panel h2{font-size:11px;text-transform:uppercase;color:#176b50;margin:0 0 10px;letter-spacing:.7px}.line{margin:5px 0;min-height:14px}.label{display:inline-block;color:#63716d;width:100px}.meta{margin:0 0 20px;display:flex;gap:30px}.meta div{min-width:150px}.meta strong{display:block;margin-top:5px}.items{width:100%;border-collapse:collapse;margin-top:8px}.items th{background:#176b50;color:white;text-transform:uppercase;font-size:10px;letter-spacing:.4px}.items th,.items td{border:1px solid #ccd8d3;padding:10px;text-align:left}.items td.num,.items th.num{text-align:right}.total-wrap{display:flex;justify-content:flex-end;margin-top:14px}.total{width:270px;border:1px solid #ccd8d3;padding:12px}.total-row{display:flex;justify-content:space-between;gap:15px}.total-row strong{font-size:17px}.notes{margin-top:28px;border:1px solid #ccd8d3;padding:12px;min-height:70px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:55px;margin-top:55px}.sign{border-top:1px solid #56635e;text-align:center;padding-top:7px;color:#56635e}.footer{margin-top:28px;text-align:center;font-size:10px;color:#63716d}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}
 </style></head><body><header><div><div class="brand">JAT GOLDEN GRAINS TRADING</div><div class="muted">PURCHASE ORDER FORM</div></div><div class="po-title"><h1>PURCHASE ORDER</h1><div class="po-number">PO No.: ${safe(poNumber)}</div><div class="muted">Date: ${safe(dateLabel())}</div></div></header><div class="details"><section class="panel"><h2>Supplier</h2><div class="line"><strong>${safe(supplierName)}</strong></div><div class="line">${address?safe(address):"Address: ______________________________"}</div><div class="line">${contact?"Contact: "+safe(contact):"Contact No.: __________________________"}</div></section><section class="panel"><h2>Order Information</h2><div class="line"><span class="label">PO Number</span>${safe(poNumber)}</div><div class="line"><span class="label">Order Date</span>${safe(todayISO())}</div><div class="line"><span class="label">Payment Terms</span>To be confirmed</div></section></div><div><strong>Dear ${safe(supplierName)},</strong><p>Please supply the following item(s) listed in this Purchase Order.</p></div><table class="items"><thead><tr><th style="width:8%">No.</th><th>Product Description</th><th style="width:15%">Unit</th><th class="num" style="width:13%">Quantity</th><th class="num" style="width:17%">Unit Cost</th><th class="num" style="width:18%">Amount</th></tr></thead><tbody><tr><td>1</td><td>${safe(product.name)}</td><td>${safe(product.kilo||"")}</td><td class="num">${qty}</td><td class="num">${peso(unitCost)}</td><td class="num">${peso(total)}</td></tr><tr><td colspan="6" style="height:28px;color:#63716d">Additional items / instructions: ______________________________________________________________</td></tr></tbody></table><div class="total-wrap"><div class="total"><div class="total-row"><span>Subtotal</span><span>${peso(total)}</span></div><hr><div class="total-row"><strong>TOTAL</strong><strong>${peso(total)}</strong></div></div></div><div class="notes"><strong>Remarks / Delivery Instructions</strong><p>________________________________________________________________________________________</p></div><div class="signatures"><div class="sign">Prepared / Ordered By</div><div class="sign">Supplier Confirmation</div></div><div class="footer">Please confirm receipt of this Purchase Order and advise the expected delivery date.</div><div class="no-print" style="text-align:center;margin-top:24px"><button onclick="window.print()" style="padding:10px 24px;font-weight:bold">Print / Save as PDF</button></div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
 w.document.close();
}

function requireAdmin(action){if(state.user.role!=="ADMIN"){alert(`ADMIN access only. You are not authorized to ${action}.`);return false}return true}
function downloadText(filename,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function printPurchasesCSV(){
 if(!requireAdmin("print Purchases as CSV"))return;
 const rows=[["ID","PO Number","Supplier Name","Address","Contact No.","Date","Product","Qty","Cost","Status"],...(state.purchases||[]).map(x=>[x.id,x.poNumber||"",x.supplierName||"",x.supplierAddress||"",x.supplierContact||"",x.date||"",x.product||"",x.qty||0,x.cost||0,x.status||"Delivered"])];
 const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
 downloadText(`JAT-Purchases-${todayISO()}.csv`,csv,"text/csv;charset=utf-8");
 setTimeout(()=>alert("Purchases CSV saved successfully."),100);
}
function printPurchasesPDF(){
 if(!requireAdmin("print Purchases as PDF"))return;
 const rows=(state.purchases||[]).map(x=>`<tr><td>${x.id}</td><td>${escapeHtml(x.poNumber||"—")}</td><td>${escapeHtml(x.supplierName||"—")}</td><td>${escapeHtml(x.supplierAddress||"—")}</td><td>${escapeHtml(x.supplierContact||"—")}</td><td>${escapeHtml(x.date||"")}</td><td>${escapeHtml(x.product||"")}</td><td>${Number(x.qty)||0}</td><td>${peso(x.cost)}</td><td>${escapeHtml(x.status||"Delivered")}</td></tr>`).join("");
 const w=window.open("","_blank","width=1200,height=750");if(!w){alert("Please allow pop-ups to print/save the Purchases PDF.");return}
 w.document.write(`<html><head><title>JAT Purchases ${todayISO()}</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #999;padding:5px;text-align:left;font-size:10px}th{background:#eee}@media print{body{padding:8px}}</style></head><body><h1>JAT Golden Grains Trading</h1><div>Purchases Report — ${dateLabel()}</div><table><thead><tr><th>ID</th><th>PO Number</th><th>Supplier Name</th><th>Address</th><th>Contact No.</th><th>Date</th><th>Product</th><th>Qty</th><th>Cost</th><th>Status</th></tr></thead><tbody>${rows||`<tr><td colspan="10">No purchases recorded.</td></tr>`}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
 w.document.close();
}
document.getElementById("printPurchasesCSV").addEventListener("click",printPurchasesCSV);document.getElementById("printPurchasesPDF").addEventListener("click",printPurchasesPDF);
function saveInventoryCSV(){if(!requireAdmin("save Inventory"))return;const rows=[["Product","KILO","Available","Inventory Cost","Stock Status"],...state.products.map(p=>[p.name,p.kilo,p.stock,p.stock*p.dealer,(Number(p.stock)||0)<=(Number(p.min)||0)?"Low Stock":"Sufficient Stock"])];const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");downloadText(`JAT-Inventory-${todayISO()}.csv`,csv,"text/csv;charset=utf-8");setTimeout(()=>alert("Inventory CSV saved successfully."),100)}
function saveInventoryPDF(){if(!requireAdmin("save Inventory as PDF"))return;const rows=state.products.map(p=>{const low=(Number(p.stock)||0)<=(Number(p.min)||0);return `<tr><td>${escapeHtml(p.name)}</td><td>${p.kilo}</td><td>${p.stock} pcs.</td><td>${peso(p.stock*p.dealer)}</td><td style="color:${low?"#c62828":"#16803c"};font-weight:700">${low?"Low Stock":"Sufficient Stock"}</td></tr>`}).join("");const w=window.open("","_blank","width=1000,height=700");if(!w){alert("Please allow pop-ups to print/save the Inventory PDF.");return}w.document.write(`<html><head><title>JAT Inventory ${todayISO()}</title><style>body{font-family:Arial;padding:30px}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #999;padding:8px;text-align:left}th{background:#eee}@media print{body{padding:10px}}</style></head><body><h1>JAT Golden Grains Trading</h1><div>Inventory Report — ${dateLabel()}</div><table><thead><tr><th>Product</th><th>KILO</th><th>Available</th><th>Inventory Cost</th><th>Stock Status</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}
document.getElementById("saveInventoryCSV").addEventListener("click",saveInventoryCSV);document.getElementById("saveInventoryPDF").addEventListener("click",saveInventoryPDF);
function openModal(title,subtitle,body){
 const modal=document.getElementById("appModal");document.getElementById("modalTitle").textContent=title;document.getElementById("modalSubtitle").textContent=subtitle||"";document.getElementById("modalBody").innerHTML=body;modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");
 modal.querySelectorAll("[data-modal-close]").forEach(el=>el.addEventListener("click",closeModal));
}
function closeModal(){const modal=document.getElementById("appModal");modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");document.getElementById("modalBody").innerHTML=""}
document.getElementById("modalClose").addEventListener("click",closeModal);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
function currentReportGroups(){
 const month=document.getElementById("reportMonth")?.value||"Whole Year",idx={January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
 return groupSalesRows(state.sales.filter(s=>month==="Whole Year"||new Date(String(s.date||"")+"T00:00:00").getMonth()===idx[month]));
}
function printSalesCSV(){
 const isAdmin=state.user?.role==="ADMIN";
 const headers=["ID","Date","Sales Invoice","Customer","Payment",...(isAdmin?["Dealer Price"]:[]),"Retail Price","Tubo/Interest","Total"];
 const rows=[headers,...currentReportGroups().sort((a,b)=>Number(b.id||0)-Number(a.id||0)).map(g=>[g.id,g.date,g.invoice,g.customer,g.paymentMode,...(isAdmin?[g.dealer]:[]),g.retail,g.profit,g.total])];
 const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");downloadText(`JAT-Sales-Report-${todayISO()}.csv`,csv,"text/csv;charset=utf-8");
}
function printSalesPDF(){
 const isAdmin=state.user?.role==="ADMIN";
 const groups=currentReportGroups().sort((a,b)=>Number(b.id||0)-Number(a.id||0));
 const headers=["ID","Date","Sales Invoice","Customer","Payment",...(isAdmin?["Dealer Price"]:[]),"Retail Price","Tubo/Interest","Total"];
 const rows=groups.map(g=>`<tr><td>${g.id}</td><td>${escapeHtml(g.date)}</td><td>${escapeHtml(g.invoice)}</td><td>${escapeHtml(g.customer)}</td><td>${escapeHtml(g.paymentMode)}</td>${isAdmin?`<td>${peso(g.dealer)}</td>`:""}<td>${peso(g.retail)}</td><td>${peso(g.profit)}</td><td>${peso(g.total)}</td></tr>`).join("");
 const w=window.open("","_blank","width=1200,height=800");if(!w){alert("Please allow pop-ups to print/save the Reports PDF.");return}w.document.write(`<html><head><title>JAT Sales Report ${todayISO()}</title><style>body{font-family:Arial;padding:25px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #999;padding:7px;text-align:left;font-size:11px}th{background:#eee}h1{margin-bottom:4px}</style></head><body><h1>JAT Golden Grains Trading</h1><div>Sales Report — ${dateLabel()}</div><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}">No sales found.</td></tr>`}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
}
document.getElementById("printSalesCSV").addEventListener("click",printSalesCSV);document.getElementById("printSalesPDF").addEventListener("click",printSalesPDF);

function renderAll(){renderDashboard();renderProducts();renderInventory();renderCustomers();renderOrders();renderExpenses();renderPurchases();renderSales();populatePOS();updateProductActionButtons();renderUsers()}



// Admin-only user management
function renderUsers(){
 const tbody=document.getElementById("usersTable");if(!tbody)return;
 const email=auth.currentUser?.email||state.user?.email||"";
 tbody.innerHTML=email?`<tr><td>${escapeHtml(email)}</td><td>${escapeHtml(state.user?.name||"Administrator")}</td><td><span class="role-pill">${escapeHtml(state.user?.role||"ADMIN")}</span></td><td>Manage accounts in Firebase Authentication</td></tr>`:`<tr><td colspan="4" class="empty-cell">Walang naka-login na Firebase user.</td></tr>`;
}
function openUserForm(username=""){
 if(!requireAdmin("manage users"))return;
 const existing=username?accounts[username]:null;
 openModal(existing?"Edit User":"Add User", "Ilagay ang account details at access role.", `<form id="userForm" class="modal-form"><div class="modal-form-grid single"><div><label>Username</label><input id="userUsername" value="${escapeHtml(username)}" ${existing?"readonly":""} required minlength="3" autocomplete="off" placeholder="e.g. cashier2"></div><div><label>Full Name</label><input id="userName" value="${escapeHtml(existing?.name||"")}" required placeholder="Full name"></div><div><label>Password ${existing?"(iwanang blank kung hindi papalitan)":""}</label><input id="userPassword" type="password" ${existing?"":"required"} minlength="4" autocomplete="new-password" placeholder="Enter password"></div><div><label>Access Role</label><select id="userRole" required><option value="ADMIN" ${existing?.role==="ADMIN"?"selected":""}>Admin</option><option value="CASHIER" ${!existing||existing.role==="CASHIER"?"selected":""}>Cashier</option></select></div></div><div class="modal-actions"><button type="button" class="primary-btn secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" type="submit">Save User</button></div></form>`);
 document.getElementById("userForm").addEventListener("submit",e=>{
  e.preventDefault();const newUsername=document.getElementById("userUsername").value.trim().toLowerCase(),name=document.getElementById("userName").value.trim(),password=document.getElementById("userPassword").value,role=document.getElementById("userRole").value;
  if(!/^[a-z0-9._-]{3,30}$/.test(newUsername)){alert("Username must be 3–30 characters and use only letters, numbers, dot, underscore, or hyphen.");return}
  if(!existing&&accounts[newUsername]){alert("May gumagamit na ng username na ito.");return}
  if(!existing&&!password){alert("Maglagay ng password.");return}
  if(password&&password.length<4){alert("Ang password ay dapat hindi bababa sa 4 characters.");return}
  const oldRole=existing?.role;accounts[newUsername]={password:password||existing.password,role,name};
  if(existing&&newUsername!==username)delete accounts[username];
  if(oldRole==="ADMIN"&&role!=="ADMIN"&&!Object.values(accounts).some(u=>u.role==="ADMIN")){accounts[newUsername].role="ADMIN";alert("Dapat may natitirang kahit isang Admin account.");}
  saveAccounts();renderUsers();closeModal();
  if(String(state.user?.username||"").toLowerCase()===username&&existing){state.user={username:newUsername,...accounts[newUsername]};localStorage.setItem("jgg_user",JSON.stringify(state.user));startApp();}
 });
}
const addUserButton=document.getElementById("addUserBtn");if(addUserButton){addUserButton.disabled=true;addUserButton.title="Manage users in Firebase Authentication";addUserButton.addEventListener("click",()=>alert("Para magdagdag ng Cashier, gumawa muna ng user sa Firebase Console > Authentication > Users. I-update rin ang Firestore Rules bago gamitin ang account."));}
const usersTable=document.getElementById("usersTable");if(usersTable)usersTable.addEventListener("click",e=>{
 const edit=e.target.closest(".user-edit-btn"),del=e.target.closest(".user-delete-btn");
 if(edit||del)alert("Ang mga account ay pinamamahalaan sa Firebase Console > Authentication > Users, hindi sa local User Management.");
});
