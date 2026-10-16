'use strict';
const {createWebhookHandler}=require('../lib/billing-webhook.cjs');
const {billingRuntime}=require('../lib/billing-runtime.cjs');
module.exports=createWebhookHandler(billingRuntime,process.env);
module.exports.config={api:{bodyParser:false}};
