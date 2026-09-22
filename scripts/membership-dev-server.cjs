'use strict';
// Isolated local front end against a hosted DEVELOPMENT Supabase project.
// Explicit configuration is mandatory: never fall back to the production API defaults.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createClient}=require('@supabase/supabase-js');
const {createHandler}=require('../lib/account-server.cjs');
const root=path.resolve(__dirname,'..');
const expected=process.env.MEMBERSHIP_DEV_PROJECT_REF;
if(!/^[a-z]{20}$/.test(expected||'') || expected==='hbovzwgpheiuuqdbzcnr' || process.env.SUPABASE_URL!==`https://${expected}.supabase.co` || !process.env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'))throw new Error('Explicit non-production development project configuration is required.');
const origin='http://localhost:8773';
const env={ACCOUNT_ALLOWED_ORIGINS:origin,MEMBERSHIP_ADMIN_ENABLED:'true',SUBSCRIPTION_ACCESS_ENABLED:'true'};
const handler=createHandler(access=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{
  ...(access?{global:{headers:{Authorization:'Bearer '+access}}}:{}),
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
}),env);
const files=new Set(['account.html','members.html','privacy.html','account.js','members.js','account-session.js','my-leagues.js','style.css','account.css','members.css','assets/Logos/favicon.svg',
  'index.html','home.css','home.js','trade_finder.html','trade-finder.js','trade-finder.css','devy_mock_simulator.html','site_sheets.js','data/site_sheets.json',
  'nfl_rankings.html','college_rankings.html','team_analyzer.html','team_analyzer.js','league_rankings.html','sos.html','best_available.html','best_available.js',
  'median_rankings.html','median_data.js','median_team.js','median_team.css','sleeper_data.js','data/weekly_points_current.json','nfl_mock_drafts.html','dynasty_mock_drafts.html',
  'trade_calculator.html','trade-calculator.js','trade-calculator.css','trade-balance.js','nfl_rankings_data.js','scoring_formats.js','data/nfl_rankings.json','nav.html','nav.js',
  'assets/icons/instagram.svg','assets/icons/x.png','assets/icons/tiktok.svg','assets/Logos/favicon-96x96.png','assets/Logos/favicon.ico','assets/Logos/apple-touch-icon.png','assets/Logos/site.webmanifest']);
const headers=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).headers;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const banner='<aside class="account-card"><strong>DEVELOPMENT TEST SITE</strong><p>Separate test accounts. No live memberships or payments.</p><a href="account.html">Test account</a> · <a href="members.html">Owner memberships</a></aside>';
http.createServer(async(req,res)=>{
  // Restrict host and origin as well as binding to loopback. Keep cookies off the old 127.0.0.1 preview.
  if(req.headers.host!=='localhost:8773'){res.writeHead(403);return res.end('Use localhost:8773.');}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,origin).pathname);}catch{res.writeHead(400);return res.end();}
  if(pathname==='/api/account')return handler(req,res);
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const rel=pathname==='/'?'account.html':pathname.slice(1);
  if(!files.has(rel)&&!/^assets\/Logos\/[a-zA-Z0-9_-]+(?:↕)?\.(png|svg)$/.test(rel)){res.writeHead(404);return res.end('This page is not included in the isolated development preview.');}
  try{
    let data=fs.readFileSync(path.join(root,rel));
    if(rel.endsWith('.html')){let html=data.toString('utf8');html=/<main(?:\s[^>]*)?>/.test(html)?html.replace(/<main(?:\s[^>]*)?>/,match=>match+banner):html.replace('<div id="nav-placeholder"></div>','<div id="nav-placeholder"></div>'+banner);data=Buffer.from(html);}
    res.setHeader('Content-Type',types[path.extname(rel)]);res.setHeader('Cache-Control','no-store');
    for(const rule of headers)if(rule.source==='/'+rel)for(const h of rule.headers)res.setHeader(h.key,h.value);
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(8773,'127.0.0.1',()=>console.log('Development test site: '+origin+'/account.html'));
