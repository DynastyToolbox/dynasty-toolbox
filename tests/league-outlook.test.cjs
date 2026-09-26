'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {outlookAction,buildPreview}=require('../lib/league-outlook.cjs');
const {resolveAccess}=require('../lib/subscription-access.cjs');
const {createHandler}=require('../lib/account-server.cjs');
const id='11111111-1111-4111-8111-111111111111';
const grant={user_id:id,plan:'premium',starts_at:'2026-01-01',expires_at:null,revoked_at:null};
const premium=resolveAccess(id,null,[grant]);
function fixture(){return {meta:{league_id:'1234567890123456789',sport:'nfl',name:'Test league',season:'2026',roster_positions:['QB','BN'],settings:{playoff_week_start:5,last_scored_leg:2},scoring_settings:{pass_td:4}},state:{season:'2026',week:3,season_type:'regular'},rosters:[{roster_id:1,owner_id:'owner',players:[],settings:{wins:1,losses:1,fpts:100,fpts_decimal:25}}],users:[{user_id:'owner',display_name:'<script>sample</script>'}],players:{},rawSchedule:[],history:{slots:[{season:2026,week:2}],weeks:[{}]},schedule:[{week:3,pairs:[],issues:['Missing opponent']},{week:4,pairs:[],issues:['Missing opponent']}]};}
test('Outlook rejects free/expired/forged access before data loading',async()=>{
  let loads=0;const load=async()=>{loads++;return fixture();};
  for(const access of [resolveAccess(null),resolveAccess(id,null,[{...grant,expires_at:'2026-01-02'}])])await assert.rejects(()=>outlookAction({league_id:'1234567890123456789',premium:true},access,{load}),{status:403});
  assert.equal(loads,0);
  await assert.rejects(()=>outlookAction({league_id:'../../secret'},premium,{load}),{status:400});assert.equal(loads,0);
});
test('premium preview returns actual records and coverage, never invented odds or private account metadata',async()=>{
  const result=await outlookAction({league_id:'1234567890123456789'},premium,{load:async()=>fixture()});
  assert.equal(result.league.teams[0].pointsFor,100.25);assert.equal(result.lineups.length,2);
  assert.ok(result.coverage.nflSchedule.length);assert.equal(result.lineups[0].projectedTeamPoints,null);
  assert.equal('owner_id' in result.league.teams[0],false);assert.equal('winProbability' in result,false);
});
test('unsupported scoring loads schedule and coverage without misleading partial point forecasts',()=>{
  const input=fixture();input.meta.scoring_settings.bonus_rec_te=1;
  const result=buildPreview(input);assert.deepEqual(result.coverage.scoring,['bonus_rec_te']);assert.equal(result.lineups.length,0);assert.equal(result.schedule.length,2);
});
test('HTTP gate defaults off, stays off in production, authenticates, and disregards browser entitlement fields',async()=>{
  async function run(env,authenticated,body={action:'outlook-league',league_id:'1234567890123456789',premium:true}){
    let queries=0;const factory=()=>({auth:{getUser:async()=>({data:{user:authenticated?{id,email_confirmed_at:'yes'}:null}})},from(table){queries++;return {select(){return {eq(){const value={data:table==='membership_subscriptions'?null:[],error:null};return {...value,maybeSingle:async()=>value};}};}};}});
    let result;const res={setHeader(){},end(raw){result={status:this.statusCode,body:JSON.parse(raw),queries};}};
    await createHandler(factory,{ACCOUNT_ALLOWED_ORIGINS:'http://localhost:8773',...env})({method:'POST',headers:{origin:'http://localhost:8773','content-type':'application/json',cookie:'dt-dev-access=test'},body},res);return result;
  }
  const enabled={SUBSCRIPTION_ACCESS_ENABLED:'true',LEAGUE_OUTLOOK_ENABLED:'true'};
  assert.equal((await run({},true)).status,503);
  assert.equal((await run({...enabled,VERCEL_ENV:'production',ACCOUNT_PUBLIC_ENABLED:'true'},true)).status,503);
  const guest=await run(enabled,false);assert.equal(guest.status,401);assert.equal(guest.queries,0);
  assert.equal((await run(enabled,true)).status,403);
});
