/* top_watch.js —— 牛顶监测页渲染逻辑（数据来自 top_watch_data.js：DERIVED_DATA / FLOW_DATA） */
(function(){
  var D = window.DERIVED_DATA, F = window.FLOW_DATA;
  if(!D || !F){ document.getElementById('overall').innerHTML = '<div class="t">数据文件未加载，请先运行 top_watch.py。</div>'; return; }

  var months = D.months, cur = D.current, peaks = D.peaks;
  var byMonth = {}; months.forEach(function(m,i){ byMonth[m.month]=i; });
  function fx(v,n){ return (v===null||v===undefined)?'—':Number(v).toFixed(n===undefined?1:n); }
  function sg(v,n){ return (v>0?'+':'')+fx(v,n===undefined?1:n); }
  function upCls(v){ return v>0?'text-up':(v<0?'text-down':''); }
  function lastMap(map){ var ks=Object.keys(map).sort(); return ks.length?{month:ks[ks.length-1],v:map[ks[ks.length-1]]}:null; }

  /* ---------- 顶部状态 ---------- */
  var inZone = cur.close>=cur.gate && (cur.bias12||0)>=D.bias_gate;
  document.getElementById('overall').innerHTML =
    '<div class="t"><b>'+cur.month+'</b> 均价 '+fx(cur.close,2)+' 元，为上轮顶 '+fx(cur.prev_top_high,2)+' 元的 '+fx(cur.close/cur.prev_top_high*100,1)+'%，顶后第 <b>'+cur.months_since_top+'</b> 个月；均价、资金'+(inZone?'均进入顶部区':'均不在顶部区')+'。</div>'+
    '<div class="tags"><span class="otag">均价线 · <b>'+(inZone?'进入顶部区':'未进入顶部区')+'</b></span>'+
    '<span class="otag">资金线 · <b>已退潮</b></span></div>'+
    '<div class="note">基于历史六轮顶部复盘，为下一轮牛顶监测做准备：看均价位置（月K、MA6、BIAS12）与增量资金（M1、月开户）何时转向。</div>';

  /* ---------- 均价线统计 ---------- */
  var ma6Pct = cur.ma6? (cur.close/cur.ma6-1)*100 : null;
  document.getElementById('priceStats').innerHTML =
    '<div class="stat"><div class="k">均价（元）</div><div class="v">'+fx(cur.close,2)+'<small>元</small></div>'+
      '<div class="d">上轮顶 '+fx(cur.prev_top_high,2)+' 元的 '+fx(cur.close/cur.prev_top_high*100,1)+'%；门槛 '+fx(cur.gate,2)+' 元（'+fx(cur.gate_pct,1)+'%）。</div></div>'+
    '<div class="stat"><div class="k">BIAS12</div><div class="v num '+upCls(cur.bias12)+'">'+sg(cur.bias12,1)+'<small>%</small></div>'+
      '<div class="d">闸门 ≥ +'+fx(D.bias_gate,1)+'%，当前'+(cur.bias12>=D.bias_gate?'进入':'远离')+'顶部区。</div></div>'+
    '<div class="stat"><div class="k">距 MA6</div><div class="v num '+upCls(ma6Pct)+'">'+sg(ma6Pct,1)+'<small>%</small></div>'+
      '<div class="d">MA6 '+fx(cur.ma6,2)+' 元，'+(cur.above_ma6?'站在 MA6 上方':'已在其下方 '+cur.months_below_ma6+' 个月。')+'</div></div>';

  /* ---------- 六轮均价表 ---------- */
  document.getElementById('tbAvg').innerHTML = D.rounds.map(function(r){
    var tag = (r.lag===null||r.lag===undefined)?'—':'<span class="num">'+r.lag+' 个月</span>';
    return '<tr><td><b>'+r.round+'</b></td><td class="num">'+r.month+'</td>'+
      '<td class="n">'+fx(r.high,2)+'</td><td class="n '+upCls(r.bias12)+'" style="font-weight:700">'+sg(r.bias12,1)+'%</td>'+
      '<td class="n">'+tag+'</td></tr>';
  }).join('');

  /* ---------- 图一：月K + MA6 + 门槛 ---------- */
  var theme = window.getChartTheme ? window.getChartTheme() : null;
  theme = theme || { text:'#666', grid:'#eee', axis:'#ddd', tooltipBg:'#fff', tooltipBorder:'#ddd', tooltipText:'#13242d', crossLabelBg:'#999', lineRed:'#dc2626', lineGreen:'#059669', lineBlue:'#2f6f86' };
  var upColor = theme?theme.lineRed:'#dc2626', downColor = theme?theme.lineGreen:'#059669';
  var dates = months.map(function(m){return m.month;});
  var candle = months.map(function(m){return [m.open,m.close,m.low,m.high];});
  var ma6Arr = months.map(function(m){return m.ma6;});
  var gateArr = D.gate;
  // 【修复】历史高点数字原来贴着 K 线画，常常被当月蜡烛的影线穿过、数字缺一笔；
  // 现在抬高 distance 并加一层底色，数字压在上方单独可读。
  var peakData = peaks.map(function(p){ return {value:[p.month,p.high], label:{
    show:p.month!=='2011-03', position:'top', distance:8, fontSize:10,
    backgroundColor: theme && theme.isLight ? 'rgba(255,255,255,.92)' : 'rgba(17,28,48,.9)',
    padding:[1,3], borderRadius:3, color: theme ? theme.text : '#666'
  }}; });

  var chartAvg = echarts.init(document.getElementById('chartAvg'));
  chartAvg.setOption({
    backgroundColor:'transparent',animationDuration:600,
    grid:{left:56,right:30,top:40,bottom:48},
    tooltip:{trigger:'axis',confine:true,
      backgroundColor:theme?theme.tooltipBg:'#fff',borderColor:theme?theme.tooltipBorder:'#ddd',
      textStyle:{color:theme?theme.tooltipText:'#13242d',fontSize:12},padding:[10,14],
      axisPointer:{type:'cross',label:{backgroundColor:theme?theme.crossLabelBg:'#999',color:'#fff'}},
      formatter:function(ps){
        var i=ps[0].dataIndex, m=months[i];
        var s='<div style="font-weight:600;font-size:13px;color:'+(theme?theme.tooltipText:'#13242d')+';margin-bottom:4px">'+m.month+'</div>';
        var closeColor = m.close>=m.open?upColor:downColor;
        s+='<div style="font-size:12px;line-height:1.75">开 <b>'+fx(m.open,2)+'</b>　高 <b>'+fx(m.high,2)+'</b>　低 <b>'+fx(m.low,2)+'</b>　收 <b style="color:'+closeColor+'">'+fx(m.close,2)+'</b></div>';
        var biasColor = (m.bias12||0)>=0?upColor:downColor;
        if(m.ma6!=null) s+='<div style="font-size:12px;line-height:1.75">MA6 <b>'+fx(m.ma6,2)+'</b>　BIAS12 <b style="color:'+biasColor+'">'+sg(m.bias12,1)+'%</b></div>';
        return s;
      }},
    xAxis:{type:'category',data:dates,boundaryGap:true,
      axisLine:{lineStyle:{color:theme?theme.axis:'#ddd'}},axisTick:{show:false},
      axisLabel:{color:theme?theme.text:'#666',fontSize:11,margin:14,
        formatter:function(v){return v.slice(0,4);},
        interval:function(i,v){return v.slice(5)==='01'&&parseInt(v.slice(0,4),10)%2===0;}},
      splitLine:{show:false}},
    yAxis:{type:'value',min:4,axisLine:{show:false},axisTick:{show:false},
      axisLabel:{color:theme?theme.text:'#666',fontSize:11,margin:12},
      splitLine:{lineStyle:{color:theme?theme.grid:'#eee',type:'dashed',width:1}}},
    series:[
      {name:'均价月K',type:'candlestick',data:candle,z:2,
        itemStyle:{color:upColor,color0:downColor,borderColor:upColor,borderColor0:downColor}},
      {name:'75% 门槛',type:'line',data:gateArr,showSymbol:false,connectNulls:false,z:1,
        lineStyle:{width:2.2,color:theme?theme.lineGreen:'#2f7662'},
        areaStyle:{color:'rgba(16,185,129,.06)',origin:'start'}},
      {name:'月线 MA6',type:'line',data:ma6Arr,showSymbol:false,z:3,
        lineStyle:{width:1.3,color:theme?theme.lineBlue:'#2f6f86',type:'dotted',opacity:.9}},
      {name:'历史均价顶',type:'scatter',z:4,silent:true,symbolSize:9,
        itemStyle:{color:'#c77a21',borderColor:theme?theme.tooltipBg:'#fff',borderWidth:1.6},
        label:{position:'top',distance:9,color:'#9a5f12',fontSize:11,fontWeight:600,
          formatter:function(p){return p.value[1].toFixed(2);}},
        data:peakData},
      {name:'门槛水位',type:'line',silent:true,symbol:'none',z:1,
        markLine:{silent:true,symbol:'none',
          label:{show:true,position:'insideStartTop',color:'#a86315',fontSize:11,distance:6,
            /* 【修复】门槛文字原来被虚线穿过，加一层底色让数字能看清 */
            backgroundColor: (theme && theme.isLight) ? 'rgba(255,255,255,.92)' : 'rgba(17,28,48,.9)',
            padding:[1,4], borderRadius:3,
            formatter:'门槛  '+fx(cur.gate,1)+' 元'},
          lineStyle:{color:'#c77a21',type:'dashed',width:1.2},
          data:[{yAxis:cur.gate}]}}
    ]
  });
  window.addEventListener('resize',function(){chartAvg.resize();});

  /* ---------- 图二：最近一轮三轨 ---------- */
  var recent = months.filter(function(m){return m.month>='2024-01';});
  var rMonths = recent.map(function(m){return m.month;});
  var rClose = recent.map(function(m){return m.close;});
  var rM1 = rMonths.map(function(k){return (k in F.m1)?F.m1[k]:null;});
  var rAcc = rMonths.map(function(k){return (k in F.accounts)?F.accounts[k]:null;});

  var m1Last = lastMap(F.m1), accLast = lastMap(F.accounts);
  var m1Peak = null, accPeak = null;
  Object.keys(F.m1).forEach(function(k){ if(k>='2024-01'&&(m1Peak===null||F.m1[k]>m1Peak.v)) m1Peak={month:k,v:F.m1[k]}; });
  Object.keys(F.accounts).forEach(function(k){ if(k>='2025-01'&&(accPeak===null||F.accounts[k]>accPeak.v)) accPeak={month:k,v:F.accounts[k]}; });

  document.getElementById('flowStats').innerHTML =
    '<div class="stat"><div class="k">M1 同比 · '+(m1Last?m1Last.month:'—')+'</div><div class="v num '+(m1Last?upCls(m1Last.v):'')+'">'+(m1Last?fx(m1Last.v,1)+'<small>%</small>':'—')+'</div>'+
      '<div class="d">本轮峰值 '+fx(m1Peak?m1Peak.v:0,1)+'%（'+(m1Peak?m1Peak.month:'—')+'），现已回落。</div></div>'+
    '<div class="stat"><div class="k">月开户 · '+(accLast?accLast.month:'—')+'</div><div class="v num">'+(accLast?fx(accLast.v,1)+'<small>万户</small>':'—')+'</div>'+
      '<div class="d">峰值 '+fx(accPeak?accPeak.v:0,1)+' 万户（'+(accPeak?accPeak.month:'—')+'），回落 '+fx(accPeak&&accLast?Math.abs(accLast.v/accPeak.v-1)*100:0,1)+'%。</div></div>'+
    '<div class="stat"><div class="k">均价 · '+cur.month+'</div><div class="v num">'+fx(cur.close,2)+'<small>元</small></div>'+
      '<div class="d">较上轮顶 '+fx(cur.prev_top_high,2)+' 元回落 <span class="num">'+fx(Math.abs(cur.vs_prev_top),1)+'%</span>。</div></div>';

  document.getElementById('recentFoot').textContent =
    (m1Peak?m1Peak.month+' M1 见顶':'')+(accPeak?' · '+accPeak.month+' 开户峰值':'')+' · '+peaks[peaks.length-1].month+' 均价顶';

  var ax={type:'category',data:rMonths,boundaryGap:true,axisLine:{lineStyle:{color:theme?theme.axis:'#ddd'}},axisTick:{show:false},
    axisLabel:{show:false},splitLine:{show:false}};
  function bands(){ return {silent:true,data:[
    [{xAxis:'2025-09',itemStyle:{color:'rgba(245,158,11,.10)'}},{xAxis:'2026-05'}],
    [{xAxis:'2026-06',itemStyle:{color:'rgba(239,68,68,.08)'}},{xAxis:rMonths[rMonths.length-1]}]]}; }
  function vlines(){ var pts=[{xAxis:'2025-09'},{xAxis:accPeak?accPeak.month:null},{xAxis:peaks[peaks.length-1].month}]
    .filter(function(p){return p.xAxis;});
    return {silent:true,symbol:'none',lineStyle:{color:theme?theme.axis:'#999',type:'dashed',width:1},data:pts}; }

  var chartRecent = echarts.init(document.getElementById('chartRecent'));
  chartRecent.setOption({
    backgroundColor:'transparent',animationDuration:900,
    tooltip:window.buildAxisTooltip?buildAxisTooltip(theme,function(ps){
      var i=ps[0].dataIndex,k=rMonths[i];
      return '<div style="font-weight:600;font-size:13px;margin-bottom:4px">'+k+'</div>'+
        '<div style="font-size:12px;line-height:1.75">平均股价　<b>'+(rClose[i]!=null?rClose[i].toFixed(2):'—')+'</b> 元</div>'+
        '<div style="font-size:12px;line-height:1.75">M1 同比　<b style="color:'+(rM1[i]!=null?(rM1[i]>=0?upColor:downColor):'inherit')+'">'+(rM1[i]!=null?rM1[i].toFixed(1)+'%':'—')+'</b></div>'+
        '<div style="font-size:12px;line-height:1.75">月开户　　<b>'+(rAcc[i]!=null?rAcc[i].toFixed(1)+' 万':'—')+'</b></div>';
    }):{},
    axisPointer:{link:[{xAxisIndex:'all'}]},
    grid:[{left:66,right:30,top:40,height:'34%'},{left:66,right:30,top:'52%',height:'17%'},{left:66,right:30,top:'76%',height:'18%'}],
    xAxis:[
      Object.assign({},ax,{gridIndex:0}),
      Object.assign({},ax,{gridIndex:1}),
      Object.assign({},ax,{gridIndex:2,axisLabel:{show:true,color:theme?theme.text:'#7A7A7A',fontSize:11,
        interval:function(i,v){return /-(01|04|07|10)$/.test(v);}}})
    ],
    yAxis:[
      {gridIndex:0,min:12,max:36,splitNumber:4,axisLabel:{color:theme?theme.text:'#7A7A7A',fontSize:11},
       axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:theme?theme.grid:'#eee',type:'dashed'}},
       name:'元',nameTextStyle:{color:theme?theme.text:"#9A9A9A",fontSize:11},nameGap:8},
      {gridIndex:1,min:-5,max:9.2,splitNumber:3,axisLabel:{color:theme?theme.text:'#7A7A7A',fontSize:11,formatter:'{value}%'},
       axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:theme?theme.grid:'#eee',type:'dashed'}}},
      {gridIndex:2,min:0,max:575,splitNumber:3,axisLabel:{color:theme?theme.text:'#7A7A7A',fontSize:11},
       axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:theme?theme.grid:'#eee',type:'dashed'}}}
    ],
    series:[
      {name:'平均股价',type:'line',xAxisIndex:0,yAxisIndex:0,data:rClose,
        lineStyle:{color:'#8a5a7a',width:3.2},itemStyle:{color:'#8a5a7a'},showSymbol:false,
        areaStyle:{color:'rgba(138,90,122,0.08)'},markArea:bands(),markLine:vlines()},
      {name:'M1 同比',type:'bar',xAxisIndex:1,yAxisIndex:1,data:rM1,barWidth:'62%',
        itemStyle:{color:function(p){return p.value>=0?upColor:downColor;},opacity:.86},markArea:bands(),
        markLine:{silent:true,symbol:'none',data:[{yAxis:0,lineStyle:{color:theme?theme.axis:'#999',width:1}}]}},
      {name:'月开户',type:'bar',xAxisIndex:2,yAxisIndex:2,data:rAcc,barWidth:'58%',
        itemStyle:{color:function(p){return (p.value||0)>=250?'#3A6EA5':'#A8BDD2';},opacity:.9},
        markArea:bands(),markLine:vlines()}
    ]
  });
  window.addEventListener('resize',function(){chartRecent.resize();});
  setTimeout(function(){chartRecent.resize();},120);

  /* ---------- 四轮资金参照表 ---------- */
  function leadTag(lead){
    if(lead===null||lead===undefined) return '<span class="tag fail">—</span>';
    if(lead<0) return '<span class="tag lag">滞后 '+(-lead)+' 月</span>';
    return '<span class="tag lead">领先 '+lead+' 月</span>';
  }
  document.getElementById('tbFlow').innerHTML = F.rounds_ref.map(function(r){
    var peak = peaks.find(function(p){return p.month===r.top;});
    var topNote = peak?('均价 '+fx(peak.high,2)+' 元'):'';
    var m1Cell = r.m1_status==='fail'
      ? '未转向<span class="sub-note">'+(r.m1_note||'')+'</span>'
      : (r.m1_peak?r.m1_peak+'　'+fx(r.m1_value,1)+'%':'—');
    var accCell = r.acc_value!=null?fx(r.acc_value,0)+' 万户':'—';
    return '<tr><td><b>'+r.top+'</b><span class="sub-note">'+topNote+'</span></td>'+
      '<td class="num">'+m1Cell+'</td><td>'+leadTag(r.m1_lead)+'</td>'+
      '<td class="num">'+accCell+'</td><td>'+leadTag(r.acc_lead)+'</td></tr>';
  }).join('');
})();
