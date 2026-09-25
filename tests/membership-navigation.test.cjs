'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {destination,accountRoute}=require('../membership-navigation.js');
test('upgrade links distinguish guest signup from customer membership',()=>{
  assert.equal(destination(null),'account.html?mode=signup&next=membership');
  assert.equal(destination(undefined),'account.html?mode=signup&next=membership');
  assert.equal(destination({id:'verified-user'}),'membership.html');
  assert.deepEqual(accountRoute('?mode=signup&next=membership'),{mode:'signup',next:'membership.html'});
});
test('account return is allowlisted, never an arbitrary URL or owner administration',()=>{
  for(const next of ['https://evil.example','//evil.example','members.html','membership.html','/membership','javascript:alert(1)'])assert.equal(accountRoute('?mode=unknown&next='+encodeURIComponent(next)).next,null);
  assert.deepEqual(accountRoute(''),{mode:'signin',next:null});
});
