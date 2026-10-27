'use strict';
const {createMonitorHandler}=require('../lib/billing-monitor-http.cjs');
const {billingRuntime}=require('../lib/billing-runtime.cjs');
module.exports=createMonitorHandler(billingRuntime,process.env);
module.exports.config={api:{bodyParser:false}};
