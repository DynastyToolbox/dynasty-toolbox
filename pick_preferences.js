(function(root){
  'use strict';
  const legacy={low:-20,neutral:0,high:20};
  const valid=value=>(typeof value==='number'&&Number.isInteger(value)&&value>=-20&&value<=20)||(typeof value==='string'&&Object.hasOwn(legacy,value));
  const percent=value=>typeof value==='number'?value:legacy[value];
  const multiplier=value=>1+percent(value)/100;
  function label(value){const n=percent(value);return n===0?'neutral':n < -5?'low':n<0?'slightly low':n<=5?'slightly high':'high';}
  const api={valid,percent,multiplier,label};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.DynastyPickPreferences=api;
})(globalThis);
