





<!DOCTYPE html>
<html lang="zh-CN" class="cn  zh-CN "  mx-toggle="canvas-menu,open-menus" toggle-class="ccg-canvas-menu-open">
<head>
	<meta charset="utf-8" /><script type="text/javascript">window.NREUM||(NREUM={});NREUM.info = {"beacon":"bam.nr-data.net","errorBeacon":"bam.nr-data.net","licenseKey":"c78035186c","applicationID":"35437814","transactionName":"YVVSMkpUDUQAVEFdW1gffTB7GiBSE0N5W1tdRUAlV1sXRQ5bWVFGGWJVFU1ZFw==","queueTime":0,"applicationTime":1597,"agent":"","atts":""}</script><script type="text/javascript">(window.NREUM||(NREUM={})).init={ajax:{deny_list:["bam.nr-data.net"]},feature_flags:["soft_nav"]};(window.NREUM||(NREUM={})).loader_config={licenseKey:"c78035186c",applicationID:"35437814",browserID:"35514979"};window.NREUM||(NREUM={}),__nr_require=function(t,e,n){function r(n){if(!e[n]){var i=e[n]={exports:{}};t[n][0].call(i.exports,function(e){var i=t[n][1][e];return r(i||e)},i,i.exports)}return e[n].exports}if("function"==typeof __nr_require)return __nr_require;for(var i=0;i<n.length;i++)r(n[i]);return r}({1:[function(t,e,n){function r(){}function i(t,e,n,r){return function(){return s.recordSupportability("API/"+e+"/called"),o(t+e,[u.now()].concat(c(arguments)),n?null:this,r),n?void 0:this}}var o=t("handle"),a=t(9),c=t(10),f=t("ee").get("tracer"),u=t("loader"),s=t(4),d=NREUM;"undefined"==typeof window.newrelic&&(newrelic=d);var p=["setPageViewName","setCustomAttribute","setErrorHandler","finished","addToTrace","inlineHit","addRelease"],l="api-",v=l+"ixn-";a(p,function(t,e){d[e]=i(l,e,!0,"api")}),d.addPageAction=i(l,"addPageAction",!0),d.setCurrentRouteName=i(l,"routeName",!0),e.exports=newrelic,d.interaction=function(){return(new r).get()};var m=r.prototype={createTracer:function(t,e){var n={},r=this,i="function"==typeof e;return o(v+"tracer",[u.now(),t,n],r),function(){if(f.emit((i?"":"no-")+"fn-start",[u.now(),r,i],n),i)try{return e.apply(this,arguments)}catch(t){throw f.emit("fn-err",[arguments,this,t],n),t}finally{f.emit("fn-end",[u.now()],n)}}}};a("actionText,setName,setAttribute,save,ignore,onEnd,getContext,end,get".split(","),function(t,e){m[e]=i(v,e)}),newrelic.noticeError=function(t,e){"string"==typeof t&&(t=new Error(t)),s.recordSupportability("API/noticeError/called"),o("err",[t,u.now(),!1,e])}},{}],2:[function(t,e,n){function r(t){if(NREUM.init){for(var e=NREUM.init,n=t.split("."),r=0;r<n.length-1;r++)if(e=e[n[r]],"object"!=typeof e)return;return e=e[n[n.length-1]]}}e.exports={getConfiguration:r}},{}],3:[function(t,e,n){var r=!1;try{var i=Object.defineProperty({},"passive",{get:function(){r=!0}});window.addEventListener("testPassive",null,i),window.removeEventListener("testPassive",null,i)}catch(o){}e.exports=function(t){return r?{passive:!0,capture:!!t}:!!t}},{}],4:[function(t,e,n){function r(t,e){var n=[a,t,{name:t},e];return o("storeMetric",n,null,"api"),n}function i(t,e){var n=[c,t,{name:t},e];return o("storeEventMetrics",n,null,"api"),n}var o=t("handle"),a="sm",c="cm";e.exports={constants:{SUPPORTABILITY_METRIC:a,CUSTOM_METRIC:c},recordSupportability:r,recordCustom:i}},{}],5:[function(t,e,n){function r(){return c.exists&&performance.now?Math.round(performance.now()):(o=Math.max((new Date).getTime(),o))-a}function i(){return o}var o=(new Date).getTime(),a=o,c=t(11);e.exports=r,e.exports.offset=a,e.exports.getLastTimestamp=i},{}],6:[function(t,e,n){function r(t,e){var n=t.getEntries();n.forEach(function(t){"first-paint"===t.name?l("timing",["fp",Math.floor(t.startTime)]):"first-contentful-paint"===t.name&&l("timing",["fcp",Math.floor(t.startTime)])})}function i(t,e){var n=t.getEntries();if(n.length>0){var r=n[n.length-1];if(u&&u<r.startTime)return;var i=[r],o=a({});o&&i.push(o),l("lcp",i)}}function o(t){t.getEntries().forEach(function(t){t.hadRecentInput||l("cls",[t])})}function a(t){var e=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(e)return e.type&&(t["net-type"]=e.type),e.effectiveType&&(t["net-etype"]=e.effectiveType),e.rtt&&(t["net-rtt"]=e.rtt),e.downlink&&(t["net-dlink"]=e.downlink),t}function c(t){if(t instanceof y&&!w){var e=Math.round(t.timeStamp),n={type:t.type};a(n),e<=v.now()?n.fid=v.now()-e:e>v.offset&&e<=Date.now()?(e-=v.offset,n.fid=v.now()-e):e=v.now(),w=!0,l("timing",["fi",e,n])}}function f(t){"hidden"===t&&(u=v.now(),l("pageHide",[u]))}if(!("init"in NREUM&&"page_view_timing"in NREUM.init&&"enabled"in NREUM.init.page_view_timing&&NREUM.init.page_view_timing.enabled===!1)){var u,s,d,p,l=t("handle"),v=t("loader"),m=t(8),g=t(3),y=NREUM.o.EV;if("PerformanceObserver"in window&&"function"==typeof window.PerformanceObserver){s=new PerformanceObserver(r);try{s.observe({entryTypes:["paint"]})}catch(h){}d=new PerformanceObserver(i);try{d.observe({entryTypes:["largest-contentful-paint"]})}catch(h){}p=new PerformanceObserver(o);try{p.observe({type:"layout-shift",buffered:!0})}catch(h){}}if("addEventListener"in document){var w=!1,b=["click","keydown","mousedown","pointerdown","touchstart"];b.forEach(function(t){document.addEventListener(t,c,g(!1))})}m(f)}},{}],7:[function(t,e,n){function r(t,e){if(!i)return!1;if(t!==i)return!1;if(!e)return!0;if(!o)return!1;for(var n=o.split("."),r=e.split("."),a=0;a<r.length;a++)if(r[a]!==n[a])return!1;return!0}var i=null,o=null,a=/Version\/(\S+)\s+Safari/;if(navigator.userAgent){var c=navigator.userAgent,f=c.match(a);f&&c.indexOf("Chrome")===-1&&c.indexOf("Chromium")===-1&&(i="Safari",o=f[1])}e.exports={agent:i,version:o,match:r}},{}],8:[function(t,e,n){function r(t){function e(){t(c&&document[c]?document[c]:document[o]?"hidden":"visible")}"addEventListener"in document&&a&&document.addEventListener(a,e,i(!1))}var i=t(3);e.exports=r;var o,a,c;"undefined"!=typeof document.hidden?(o="hidden",a="visibilitychange",c="visibilityState"):"undefined"!=typeof document.msHidden?(o="msHidden",a="msvisibilitychange"):"undefined"!=typeof document.webkitHidden&&(o="webkitHidden",a="webkitvisibilitychange",c="webkitVisibilityState")},{}],9:[function(t,e,n){function r(t,e){var n=[],r="",o=0;for(r in t)i.call(t,r)&&(n[o]=e(r,t[r]),o+=1);return n}var i=Object.prototype.hasOwnProperty;e.exports=r},{}],10:[function(t,e,n){function r(t,e,n){e||(e=0),"undefined"==typeof n&&(n=t?t.length:0);for(var r=-1,i=n-e||0,o=Array(i<0?0:i);++r<i;)o[r]=t[e+r];return o}e.exports=r},{}],11:[function(t,e,n){e.exports={exists:"undefined"!=typeof window.performance&&window.performance.timing&&"undefined"!=typeof window.performance.timing.navigationStart}},{}],ee:[function(t,e,n){function r(){}function i(t){function e(t){return t&&t instanceof r?t:t?u(t,f,a):a()}function n(n,r,i,o,a){if(a!==!1&&(a=!0),!l.aborted||o){t&&a&&t(n,r,i);for(var c=e(i),f=m(n),u=f.length,s=0;s<u;s++)f[s].apply(c,r);var p=d[w[n]];return p&&p.push([b,n,r,c]),c}}function o(t,e){h[t]=m(t).concat(e)}function v(t,e){var n=h[t];if(n)for(var r=0;r<n.length;r++)n[r]===e&&n.splice(r,1)}function m(t){return h[t]||[]}function g(t){return p[t]=p[t]||i(n)}function y(t,e){l.aborted||s(t,function(t,n){e=e||"feature",w[n]=e,e in d||(d[e]=[])})}var h={},w={},b={on:o,addEventListener:o,removeEventListener:v,emit:n,get:g,listeners:m,context:e,buffer:y,abort:c,aborted:!1};return b}function o(t){return u(t,f,a)}function a(){return new r}function c(){(d.api||d.feature)&&(l.aborted=!0,d=l.backlog={})}var f="nr@context",u=t("gos"),s=t(9),d={},p={},l=e.exports=i();e.exports.getOrSetContext=o,l.backlog=d},{}],gos:[function(t,e,n){function r(t,e,n){if(i.call(t,e))return t[e];var r=n();if(Object.defineProperty&&Object.keys)try{return Object.defineProperty(t,e,{value:r,writable:!0,enumerable:!1}),r}catch(o){}return t[e]=r,r}var i=Object.prototype.hasOwnProperty;e.exports=r},{}],handle:[function(t,e,n){function r(t,e,n,r){i.buffer([t],r),i.emit(t,e,n)}var i=t("ee").get("handle");e.exports=r,r.ee=i},{}],id:[function(t,e,n){function r(t){var e=typeof t;return!t||"object"!==e&&"function"!==e?-1:t===window?0:a(t,o,function(){return i++})}var i=1,o="nr@id",a=t("gos");e.exports=r},{}],loader:[function(t,e,n){function r(){if(!M++){var t=T.info=NREUM.info,e=m.getElementsByTagName("script")[0];if(setTimeout(u.abort,3e4),!(t&&t.licenseKey&&t.applicationID&&e))return u.abort();f(x,function(e,n){t[e]||(t[e]=n)});var n=a();c("mark",["onload",n+T.offset],null,"api"),c("timing",["load",n]);var r=m.createElement("script");0===t.agent.indexOf("http://")||0===t.agent.indexOf("https://")?r.src=t.agent:r.src=l+"://"+t.agent,e.parentNode.insertBefore(r,e)}}function i(){"complete"===m.readyState&&o()}function o(){c("mark",["domContent",a()+T.offset],null,"api")}var a=t(5),c=t("handle"),f=t(9),u=t("ee"),s=t(7),d=t(2),p=t(3),l=d.getConfiguration("ssl")===!1?"http":"https",v=window,m=v.document,g="addEventListener",y="attachEvent",h=v.XMLHttpRequest,w=h&&h.prototype,b=!1;NREUM.o={ST:setTimeout,SI:v.setImmediate,CT:clearTimeout,XHR:h,REQ:v.Request,EV:v.Event,PR:v.Promise,MO:v.MutationObserver};var E=""+location,x={beacon:"bam.nr-data.net",errorBeacon:"bam.nr-data.net",agent:"js-agent.newrelic.com/nr-1216.min.js"},O=h&&w&&w[g]&&!/CriOS/.test(navigator.userAgent),T=e.exports={offset:a.getLastTimestamp(),now:a,origin:E,features:{},xhrWrappable:O,userAgent:s,disabled:b};if(!b){t(1),t(6),m[g]?(m[g]("DOMContentLoaded",o,p(!1)),v[g]("load",r,p(!1))):(m[y]("onreadystatechange",i),v[y]("onload",r)),c("mark",["firstbyte",a.getLastTimestamp()],null,"api");var M=0}},{}],"wrap-function":[function(t,e,n){function r(t,e){function n(e,n,r,f,u){function nrWrapper(){var o,a,s,p;try{a=this,o=d(arguments),s="function"==typeof r?r(o,a):r||{}}catch(l){i([l,"",[o,a,f],s],t)}c(n+"start",[o,a,f],s,u);try{return p=e.apply(a,o)}catch(v){throw c(n+"err",[o,a,v],s,u),v}finally{c(n+"end",[o,a,p],s,u)}}return a(e)?e:(n||(n=""),nrWrapper[p]=e,o(e,nrWrapper,t),nrWrapper)}function r(t,e,r,i,o){r||(r="");var c,f,u,s="-"===r.charAt(0);for(u=0;u<e.length;u++)f=e[u],c=t[f],a(c)||(t[f]=n(c,s?f+r:r,i,f,o))}function c(n,r,o,a){if(!v||e){var c=v;v=!0;try{t.emit(n,r,o,e,a)}catch(f){i([f,n,r,o],t)}v=c}}return t||(t=s),n.inPlace=r,n.flag=p,n}function i(t,e){e||(e=s);try{e.emit("internal-error",t)}catch(n){}}function o(t,e,n){if(Object.defineProperty&&Object.keys)try{var r=Object.keys(t);return r.forEach(function(n){Object.defineProperty(e,n,{get:function(){return t[n]},set:function(e){return t[n]=e,e}})}),e}catch(o){i([o],n)}for(var a in t)l.call(t,a)&&(e[a]=t[a]);return e}function a(t){return!(t&&t instanceof Function&&t.apply&&!t[p])}function c(t,e){var n=e(t);return n[p]=t,o(t,n,s),n}function f(t,e,n){var r=t[e];t[e]=c(r,n)}function u(){for(var t=arguments.length,e=new Array(t),n=0;n<t;++n)e[n]=arguments[n];return e}var s=t("ee"),d=t(10),p="nr@original",l=Object.prototype.hasOwnProperty,v=!1;e.exports=r,e.exports.wrapFunction=c,e.exports.wrapInPlace=f,e.exports.argsToArray=u},{}]},{},["loader"]);</script>
	<title >检验PMG评级 | PMG</title>
	
<script src="/resources/scripts/gtm/?id=GTM-KZLVGHD&ga=G-G79MJNSN0T"></script>
	<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
<meta name="ccg-uptime-verification" content="its up" />
<link rel="apple-touch-icon" sizes="180x180" href="/resources/images/logos/icons/apple-touch-icon.png">
<meta name="msapplication-square70x70logo" content="/resources/images/logos/icons/scales-70.png" />
<meta name="msapplication-square150x150logo" content="/resources/images/logos/icons/scales-150.png" />
<meta name="msapplication-wide310x150logo" content="/resources/images/logos/icons/scales-310x150.png" />
<meta name="msapplication-square310x310logo" content="/resources/images/logos/icons/scales-310.png" />
<meta name="msapplication-TileColor" content="#064C2A" />
<meta name="application-name" content="PMG" />
<meta content="noindex" name="robots"></meta>




	
	
	<link rel="stylesheet" href="/resources/bower/angular-ui-grid/ui-grid.min.css" />
	<link href="/bundles/mvc/plugins-css?v=8phsnTIybOlgwOqm38n0-W1AJQplGdLiNSPHX7RO_901" rel="stylesheet"/>

	
<link href="/cassette.axd/stylesheet/bf335cba51c7594c0c5bd2db8b72f63f3536ab05/bundles/mvc/site-css" type="text/css" rel="stylesheet"/>

	<script src="/bundles/mvc/modernizr-js?v=c5gdv8IRHoIwY0sv40PyxA1waUyHFq6RftwGaIy33dk1"></script>


</head>
<body class="certlookup-results full-width hide-background"  mx-toggle="inner-sidebar" toggle-class="inner-sidebar-open">
	

<div class="inactivity-banner" ng-controller="inactivityBannerController as $ctrl" ng-show="$ctrl.show" ng-cloak>
	<div class="inactivity-banner-dialog">
		<span>{{$ctrl.message}}</span>
		<button type="button" class="inactivity-banner-close" ng-click="$ctrl.dismiss()" aria-label="Close">
			<span aria-hidden="true">&times;</span>
		</button>
	</div>
</div>

	
	<!-- Google Tag Manager (noscript) -->
		<noscript>
			<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-KZLVGHD"
					height="0" width="0" style="display:none;visibility:hidden">
			</iframe>
		</noscript>
	<!-- End Google Tag Manager (noscript) -->

	
	<div class="ccg-canvas" mx-toggle="open-menus" mx-toggler-for="-open-menus">
		<header class="ccg-header iframe-hide">
			<div class="content-wrapper content-pad-horizontal flex">
					<div class="ccg-menu-toggle ccg-main-menu-toggle" mx-toggler-for="canvas-menu">
						<div class="ccg-menu-toggle-text menu">菜单</div>
					</div>
									<a class="ccg-header-logo" href="/"><span class="anchor-text">PMG Notes</span></a>
				<div class="ccg-header-toolbar">
					
						<nav class="ccg-menu horizontal ccg-anonymous-menu iframe-hide">
							 <ul>
	<li><a href="/account/login/?ReturnUrl=%2fcertlookup%2f2346059-033%2f67%2f" rel="nofollow">登入</a></li>

        <li><a href="/join/" class="btn primary">加入</a></li>
</ul>
 
						</nav>
					  
				</div>
			</div>
		</header>
			<nav class="ccg-menu ccg-main-menu iframe-hide" mx-dropdown>
				 <ul>
	<li>
		<span>关于</span>
		<ul>
			<li><a href="/about/about-pmg/">关于PMG</a></li>
			<li><a href="/about/paper-money-collecting/">纸币收藏介绍</a></li>
				<li><a href="/about/banknote-buying-guide/">纸币购买指南</a></li>
			<li><a href="/about/faq/">常见问题</a></li>
			<li><a href="https://www.collectiblesgroup.com/careers/" target="_blank">工作机会</a></li>
			
		</ul>
	</li>
	<li>
		<span>纸币评级</span>
		<ul>
				<li><a href="/paper-money-grading/grading-process/">PMG评级流程</a></li>
							<li><a href="/paper-money-grading/grading-scale/">PMG纸币评级标准</a></li>
				<li class="has-flyout">
					<span>封套和标签</span>
					<ul>
						<li><a href="/paper-money-grading/holder-label/">封套</a></li>
							<li><a href="/news/article/7457/PMG-Special-Labels/">标签</a></li>
					</ul>
				</li>
				<li><a href="/paper-money-grading/designations/">PMG的发行专称</a></li>

			<li><a href="/news/article/5379/First-and-Early-Releases-Cutoff-Dates/">早期/首期发行截止日期</a></li>
			<li><a href="/paper-money-grading/pmg-guarantee/">PMG 保证</a></li>
		</ul>
	</li>
	<li>
		<span>提交</span>
		<ul>
			<li><a href="/submit/how-to-submit/">如何提交</a></li>
				<li><a href="/submit/notes-we-grade/">评级纸币及PMG政策</a></li>
							<li><a href="/submit/submission-process/">提交程序</a></li>
							<li><a href="/submit/services-fees/">服务和费用</a></li>
													<li><a href="/account/my-submissions/tracking/" rel="nofollow">提交追踪</a></li>
			<li><a href="/submit/events/">活动</a></li>
		</ul>
	</li>
	<li><a href="/news/">新闻</a></li>
	<li>
		<span>资源 </span>
		<ul>
				<li><a href="/population-report/">PMG 数量报告</a></li>
				<li><a href="/resources/world-paper-money-price-guide/">世界纸币价格指南</a></li>
			<li><a href="/certlookup/">检验PMG评级</a></li>
				<li><a href="/banknote-dealer-locator/">查找经销商</a></li>
				<li><a href="/pmg-registry/">PMG 纸币登记处</a></li>
									<li><a href="/news/article/7448/pmg-glossary/">术语释义</a></li>
		</ul>
	</li>
	<li class="site-search">
		
<div class="site-search-container" ng-non-bindable>
	<form method="get" action="/search-results/">
		<table cellspacing="0" cellpadding="0" class="site-search-box">
			<tbody>
				<tr>
					<td class="site-search-input">
						<input type="text" name="q" autocomplete="off" title="search" spellcheck="false" />
					</td>
					<td class="site-search-button">
						<input type="submit" value="Search" title="search" />
					</td>
				</tr>
			</tbody>
		</table>
	</form>
</div>

	</li>
</ul>
 
			</nav>
			<div class="ccg-menu-overlay"></div>
		<div class="ccg-body">
			
			<div class="inner-main">
																								










<div class="ng-cloak main-content content-pad flex">
	






<section class="ccg-page-header">
	<div class="ccg-page-header__inner">
		<a class="ccg-page-header__title ccg-page-header__title--breadcrumb" href="/certlookup/">检验PMG评级</a>
	</div>
</section>

<label id="cfDown" style="display:none;"><strong>您的搜索活动已经超过我们的限制。这些限制是为我们的数据库安全而设。请稍后再试。</strong></label>
<!--sse--> <!-- Cloudflare scrape protection beginning tag -->
<div class="results-pane">
	<div class="certlookup-intro">
		<div class="content-wrapper certlookup-wrapper">
			<div>
				<div class="certlookup-search-box">
					<div class="certlookup-search-toggle">
						<h3><i class="icon-search"></i>新的搜寻</h3>
					</div>
					<div class="certlookup-search-content">
						

<div class="ccg-form" cert-lookup-search>
	<form name="form" ng-submit="$ctrl.lookup($ctrl.certNumber, $ctrl.grade)" class="certlookup-form pmg">
		<div class="certlookup-fields">
			<div class="certlookup-field">
				<label>评级号码</label>
				<input type="tel" class="certlookup-number-field" name="CertNumber" placeholder="1234567-999" autocomplete="off" ccg-ignore-model-override
					ng-model="$ctrl.certNumber" required maxlength="11" pattern="\d{7}-?\d{3}" />
				<span class="error required" mx-validation-message="form.CertNumber" for-required="这是必填项。"></span>
			</div>
			<div class="certlookup-field">
				<label>评分</label>
				<select class="certlookup-grade-field" name="Grade" ng-model="$ctrl.grade" required ccg-ignore-model-override>
					<option value=""></option>
					<option value="NonNumeric">非数值</option>
						<option>70</option>
						<option>69</option>
						<option>68</option>
						<option>67</option>
						<option>66</option>
						<option>65</option>
						<option>64</option>
						<option>63</option>
						<option>62</option>
						<option>61</option>
						<option>60</option>
						<option>58</option>
						<option>55</option>
						<option>53</option>
						<option>50</option>
						<option>45</option>
						<option>40</option>
						<option>35</option>
						<option>30</option>
						<option>25</option>
						<option>20</option>
						<option>15</option>
						<option>12</option>
						<option>10</option>
						<option>8</option>
						<option>6</option>
						<option>4</option>
						<option>2</option>
						<option>1</option>
					<option value="NotListed">不在表单内</option>
				</select>
				<button type="submit" name="lookup" mx-submit-status>前往</button>
				<span class="error" mx-validation-message="form.Grade" for-required="这是必填项。"></span>
			</div>
		</div>
		<div class="error error-message" ng-show="!$ctrl.isHomepage && $ctrl.errorMessage">
			<span ng-if="$ctrl.errorMessage === $ctrl.lookupStatus.erpDown">这项功能暂时并不提供。请稍后再试。</span>
			<span ng-if="$ctrl.errorMessage === $ctrl.lookupStatus.contactSupport">[[ContactSupport]]</span>
			<span ng-if="$ctrl.errorMessage === $ctrl.lookupStatus.rateLimited">您的搜索活动已经超过我们的限制。这些限制是为我们的数据库安全而设。请稍后再试。</span>
			<span ng-if="$ctrl.errorMessage === $ctrl.lookupStatus.notFound">找不到这个项目。请检查PMG 证书编号输入是否正确。<span ccg-tooltip="请留意：项目必须装运之后才可以进行搜索。请再尝试或者联络 <a href='../../../contact/'>PMG 客户服务。" persist-tooltip require-click><a>更多帮助&nbsp;></a></span></span>
		</div>
	</form>
</div>

					</div>
				</div>
			</div>
			<div class="certlookup-results-data">
						<dl>
			<dt>PMG评级号码</dt>
			<dd>2346059-033</dd>
		</dl>

		<dl>
			<dt>纸币说明: </dt>
			<dd>China / People&#39;s Republic, 2 Yuan 1990</dd>
		</dl>
				<div class="related-info">
							<dl>
			<dt>纸币#: </dt>
			<dd>CHN885b</dd>
		</dl>

							<dl>
			<dt>序列号: </dt>
			<dd>WG11911933</dd>
		</dl>

							<dl>
			<dt>地区: </dt>
			<dd>CHN</dd>
		</dl>

				</div>
				<dl>
					<dt>等级: </dt>
							<dd>67 EPQ</dd>
				</dl>
				
						<dl>
			<dt>签名: </dt>
			<dd>- Wmk: Pu Coin</dd>
		</dl>

						<dl>
			<dt>评论: </dt>
			<dd>Exceptional Paper Quality</dd>
		</dl>

				
			</div>
		</div>
	</div>

	<div class="certlookup-details">
		<div class="content-wrapper">
						<div class="certlookup-images" ccg-fancybox-images>
				<div class="certlookup-images-item">
					<a href="https://ccg-imaging-pmg-notes-production.s3.amazonaws.com/17284820-4746-476d-8424-acb3b0f40e30/PMG2346059-033_REV.jpg">
						<img title="Reverse" src="https://ccg-imaging-pmg-notes-production.s3.amazonaws.com/17284820-4746-476d-8424-acb3b0f40e30/TN_PMG2346059-033_REV.jpg" />
					</a>
				</div>
				<div class="certlookup-images-item">
					<a href="https://ccg-imaging-pmg-notes-production.s3.amazonaws.com/17284820-4746-476d-8424-acb3b0f40e30/PMG2346059-033_OBV.jpg">
						<img title="Obverse" src="https://ccg-imaging-pmg-notes-production.s3.amazonaws.com/17284820-4746-476d-8424-acb3b0f40e30/TN_PMG2346059-033_OBV.jpg" />
					</a>
				</div>
			</div>
			<div class="certlookup-details-wrapper">
				<ul class="certlookup-stats">
					<li>
							<a class="certlookup-stats-item" href="/population-report/china/china/2-yuan/?n=85465&amp;grade=67EPQ" target="_blank">
								<i class="icon-census"></i>
								<div class="certlookup-stats-item-content">
									<div class="certlookup-stats-item-label">获PMG评级的总数</div>
										<div class="certlookup-stats-item-value value-smaller">获67EPQ分 : 23,607</div>
										<div class="certlookup-stats-item-value value-smaller">获得更高评分的数目: 5,512</div>
								</div>
							</a>
					</li>
				</ul>
			</div>
			<div class="certlookup-disclaimer">
				<p>
如果以上显示的信息不正确或与您正在验证的纸币不符，或者您认为您拥有的是伪造或篡改过的PMG封套，请联系<a href="mailto:Service@PMGnotes.cn" target="_blank">Service@PMGnotes.cn</a>。了解更多关于伪造或篡改的PMG封套，请点击<a href="/paper-money-grading/holder-label/">这里</a>。 <br /><br />
					<a ng-click="totalGradedModal = true">获PMG评级的总数:此数量是如何计算的?</a>
					<div ccg-modal="totalGradedModal" allow-close="true">
						<p>某个特定评级等级下的纸币数量反映了相应等级(包括任何被评为“NET”的纸币)和标识(例如“EPQ”)下，经PMG评级的纸币数量。“获得更高等级”的数量反映了经PMG评级后，比该张纸币所获等级更高(包括更高等级却带有“NET”标识的纸币)和/或标识更好的纸币数量。对于被评为“NET”的纸币，数量将只反映被评为“NET”的纸币。<br><br>例如，如果一张纸币的等级为PMG 58 Uncirculated，则显示的数量将为所有等级为PMG 58 Uncirculated的纸币数量。“获得更高评级等级”的数量将包括评级等级为PMG 58 Uncirculated EPQ、PMG 60 Uncirculated Net、PMG 60 Uncirculated、PMG 60 Uncirculated EPQ等的纸币数量。<br><br>有关PMG评级标准和标识信息，请点击<a href="/paper-money-grading/grading-scale/">这里</a>。</p>
					</div>
				</p>
			</div>
		</div>
	</div>
</div>
<!--/sse--> <!-- Cloudflare scrape protection ending tag -->
<section class="ccg-info-callouts">
	<div class="ccg-info-callouts__inner">
		<div class="ccg-info-callouts__item">
			<h3>PMG保证</h3>
			每一张经PMG评级的纸钞都有专业的PMG保证，PMG保证对买卖双方提供更有效的保护。
			<a href="/paper-money-grading/pmg-guarantee/">了解更多</a>
		</div>
		<div class="ccg-info-callouts__item">
			<h3>PMG纸币评级标准</h3>
			请阅读PMG所使用的等级和描述详细列表。
			<a href="/paper-money-grading/grading-scale/">了解更多</a>
		</div>
	</div>
</section>



</div>


				 

	<div class="ad-bottom" ccg-dfp-ad="dfp-pmg_footer"></div>

<div class="ng-cloak upper-footer">
	<div class="grading-service">
		<div class="ogs-title">PMG是以下组织的官方评级机构</div>
		<nav class="ccg-menu horizontal">
			<ul>
					<li><a class="ana" title="ANA" href="https://www.money.org/" ccg-analytics-event category="External Link" action="Click - Affiliate" label="ANA" target="_blank"><span class="anchor-text">American Numismatic Association</span></a></li>
					<li><a class="png" title="PNG" href="https://pngdealers.org/" ccg-analytics-event category="External Link" action="Click - Affiliate" label="PNG" target="_blank">Professional Numismatists Guild<span class="anchor-text"></span></a></li>
									<li><a class="cdhcd disable-link" title="CDHCD" href="https://www.facebook.com/RoundTableCoins/" target="_blank" ccg-analytics-event category="External Link" action="Click - Affiliate" label="CDHCD"><span class="anchor-text">CDHCD</span></a></li>
			</ul>
		</nav>
	</div>
	<div class="grading-service">
		<div class="ogs-title center">PMG为以下公司认可的评级机构</div>
		<nav class="ccg-menu horizontal">
			<ul>
					<li><a class="ma-shops" title="MA Shops" href="https://www.ma-shops.com/" target="_blank" ccg-analytics-event category="External Link" action="Click - Affiliate" label="MA Shops"><span class="anchor-text">MA Shops</span></a></li>
					<li><a class="cdn" title="CDN Exchange" href="https://www.cdnexchange.com/" target="_blank" ccg-analytics-event category="External Link" action="Click - Affiliate" label="CDN Exchange"><span class="anchor-text">CDN Exchange</span></a></li>
				<li><a class="view-all-affiliates" href="/affiliates/">查看全部 <i class="icon-next"></i></a></li>
			</ul>
		</nav>
	</div>
	<div class="footer-disclaimer">
		当您点击此网站上的各种商家链接并完成一次购买后，此网站便会获得一笔佣金。关联项目及关联方包括但不限于eBay合作伙伴网络（eBay Partner Network）。
	</div>
</div>
 
					<footer class="ccg-footer content-pad flex iframe-hide">
						 <div class="ng-cloak section">
		<ul class="social-icons">
			<li>
				<div class="social-icons-wrapper">
					<a class="icon-wechat wechat" mx-toggler-for="wechat-details"></a>
					<div class="ccg-menu social-details"  mx-toggle="wechat-details"  toggle-class="open">
						<ul>
							<li class="hide-for-touch"><img class="qr-code" src="/resources/ccg-shared/images/template/wechat-qr.jpg?cb=2018-06-07" /></li>
							<li class="show-for-touch">微信搜索公众号“NGC上海”或者扫描下方二维码，关注我们！</li>
						</ul>
					</div>
				</div>
			</li>
		</ul>
			<div class="logos">
		<nav class="ccg-menu horizontal">
			<ul>
						<li><a class="ngc" href="https://www.ngccoin.cn/" target="_blank"><span class="anchor-text">NGC Coin</span></a></li>
										<li><a class="cgc" href="https://www.cgcgrading.com/" target="_blank"><span class="anchor-text">CGC Comics</span></a></li>
				 <li><a class="asg" href="https://www.asgstamps.cn/" target="_blank"><span class="anchor-text">ASG Stamps</span></a></li> 				<li><a class="jsa" href="https://www.spenceloa.com/" target="_blank"><span class="anchor-text">JSA Authentication</span></a></li>
				<li><a class="ccg" href="https://www.collectiblesgroup.com/" target="_blank"><span class="anchor-text">Collectibles Group</span></a></li>
			</ul>
		</nav>
	</div>
</div>
<div class="ng-cloak section">
	<nav class="site-links">
		<ul class="footer-menu">
<li><a href="https://www.collectiblesgroup.com/careers/" target="_blank">工作机会</a></li>
<li><a href="/legal/terms-of-use/">网站使用条款</a></li>
<li><a href="/legal/privacy-policy/">隐私政策</a></li>
<li><a href="/affiliates/">附属机构</a></li>
<li><a href="/contact/">联系信息</a></li>
		<li><a href="https://beian.miit.gov.cn/" target="_blank">沪ICP备15028167号-2</a></li>
		</ul>
		<br />
		<ul>
 <li class="copyright">&copy; 2026 上海诚颉藏商务信息咨询有限公司</li> 		</ul>
		<div ccg-site-selector></div>
	</nav>
</div>
 
					</footer>
			</div>
		</div>
	</div>

	  
	<a ccg-scroll-top></a>

	<script>window.baseUrl = "/";</script>
	
	<div id="scripts" class="hidden">
		<script src="/bundles/mvc/core-js?v=8hokiNYbZwvIJV75uBixAfJWvrDoDnyQdgI_mUWkjg81"></script>
<script src="/bundles/mvc/plugins-js?v=9kBZsuRpmCXlfyMvrX5rlA0JID59AS_wKlRuRn9Greg1"></script>
<script src="/bundles/mvc/JsBarcode?v=yoxccOAQQzZKanAsMQsMmMkhLiahkrz5peEAk5GRSUM1"></script>

		<script src="/resources/bower/tinymce/tinymce.min.js?v=Gdozmu4sw8Hv7TSeuQVzVyGYfun3d-dJ6-N_FHqSQuE1"></script>

		<script src="/Resources/bower/angular-i18n/angular-locale_zh-CN.js"></script>
<script>
	var CCG = {
		application: angular.module("CCG.PMGNotes", [
			"ngAnimate", "ngRoute", "ngSanitize", "ngFileUpload", "ngMask",
			"MxGroup.Shared", "CCG.Shared", "dndLists", "angucomplete-alt",
			"ui.grid", "ui.grid.pagination", "ui.grid.autoResize",
			"ui.tinymce", "moment-picker"
		]),
		culture: "zh-CN",
		rootUrl: window.baseUrl,
		basePageUrl: "/certlookup/2346059-033/67/",
		user: {},
		tld: "cn",
		showRecaptcha: false,
		recaptchaSiteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
	};
	angular.module("CCG.PMGNotes")
		.config(function($animateProvider) {
			$animateProvider.classNameFilter(/ccg-animate-/);
		})
		.config(function($locationProvider) {
			$locationProvider.html5Mode({
				enabled: true,
				requireBase: false,
				rewriteLinks: "router-link",
			});
		})
		.config(function(DfpAdServiceProvider) {
			DfpAdServiceProvider.defineSizeMapping("banner", [
				[[800, 0], [728, 90]],
				[[0, 0], [300, 250]]
			]);
			DfpAdServiceProvider.defineSizeMapping("header", [
				[[800, 0], [728, 90]],
				[[0, 0], [320, 50]]
			]);

			DfpAdServiceProvider.defineSlot("dfp-pmg_content_a", [728, 90], "header");
			DfpAdServiceProvider.defineSlot("dfp-pmg_content_b", [728, 90], "banner");
			DfpAdServiceProvider.defineSlot("dfp-pmg_footer", [728, 90], "banner");
			DfpAdServiceProvider.defineSlot("dfp-pmg_sidebar_right", [160, 600]);
			DfpAdServiceProvider.defineSlotPrefix("/564607068/dfp-pmg-cn/");
		})
		.config(function(momentPickerProvider) {
			momentPickerProvider.options({
				/* Picker properties */
				locale:        'en',
				format:        'L LTS',
				minView:       'decade',
				maxView:       'hour',
				startView:     'year',
				autoclose:     true,
				today:         false,
				keyboard:      false,

				/* Extra: Views properties */
				leftArrow:     '&larr;',
				rightArrow:    '&rarr;',
				yearsFormat:   'YYYY',
				monthsFormat:  'MMM',
				daysFormat:    'D',
				hoursFormat:   'HH:[00]',
				minutesFormat: moment.localeData().longDateFormat('LT').replace(/[aA]/, ''),
				secondsFormat: 'ss',
				minutesStep:   5,
				secondsStep:   1
			});
		})
		.config(function(siteSelectorServiceProvider) {
			siteSelectorServiceProvider.addSites([
				{ name: "United States",  className: "com", url: "https://www.pmgnotes.com/" },
				{ name: "中國",           className: "cn", url: "https://www.pmgnotes.cn/" },
				{ name: "Deutschland",    className: "de", url: "https://www.pmgnotes.de/" },
				{ name: "香港-中国",		  className: "hk", url: "https://www.pmgnotes.hk/" },
				{ name: "India",           className: "in", url: "https://www.pmgnotes.in/" },
				{ name: "대한민국",       className: "kr", url: "https://www.pmgnotes.kr/" },
				{ name: "United Arab Emirates", className: "ae", url: "https://www.pmgnotes.ae/" },
				{ name: "United Kingdom", className: "uk", url: "https://www.pmgnotes.uk/" },
			]);
			siteSelectorServiceProvider.setCurrentSite("cn");
		});

	$(document).ready(function() {
		angular.bootstrap(document, ["CCG.PMGNotes"]);
	});
</script>

	<script>
		(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
			(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
			m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
		})(window,document,'script','//www.google-analytics.com/analytics.js','ga');

		ga('create', 'UA-65954466-1', 'auto', {
			siteSpeedSampleRate: 100
		});
		ga('send', 'pageview');
	</script>


		
		<script src="/bundles/mvc/ccg-shared-js?v=CL4ip6u595u-i04arf8faa2V7CouVCPECF8KC6NONMI1"></script>
<script src="/bundles/mvc/site-js?v=w1zHAcW0rOlNv3ILqbJglcMr3O1IeDjN4ImRsMV51es1"></script>

		


		
		<script src="/resources/scripts/translation-dictionary/?lang=zh-CN&cb=06dc380a-2930-4591-8e0e-3d97649fe282"></script>

		<script>
			$.extend(CCG.user, {"PeopleID":0,"Username":null,"Email":null,"AccountTier":null,"IsPaidDealer":false,"CanViewPackingSlips":false,"UserType":null,"IsLoggedIn":false,"Score":0,"Rank":null,"HasAgreedToTerms":false,"AcceptAutoRenewal":false,"IsCreditCardInvalid":false,"IgnoreMinRequirementOnTiers":false,"IgnoreMinRequirementOnAddOns":false});

			angular.module("CCG.Shared")
				.value("pagerLinkText", {
					of: "/"
				});
		</script>
		
	<script>
		// accordion
		$(document).ready(function () {
			$('.certlookup-search-toggle').click(function() {
				$('.certlookup-search-content').toggleClass('active');
			});
		});

		if(!document.getElementsByClassName('results-pane').length) {
			document.getElementById("cfDown").style.display = "block";
		} else {
			document.getElementById("cfDown").style.display = "none";
		}
	</script>

	</div>
	






	<!-- Inactivity Session Monitor for .cn sites -->
	<ccg-inactivity-modal authenticated="false"></ccg-inactivity-modal>
</body>
</html>