function getBaseDomain(hostname){
  const parts = hostname.split('.').reverse();
  if (parts.length > 2) return parts[1] + '.' + parts[0];
  return hostname;
}
(function(){
  try{
    const domain = getBaseDomain(window.location.hostname);
    chrome.storage.local.get([domain], (res)=>{
      if(res[domain]){
        const style = document.createElement('style');
        style.id='dynamicCssStyle';
        style.textContent = res[domain];
        document.documentElement.appendChild(style);
      }
    });
    chrome.storage.onChanged.addListener((changes, areaName)=>{
      if(areaName==='local' && changes[domain]){
        const oldStyle = document.getElementById('dynamicCssStyle');
        if(oldStyle) oldStyle.remove();
        const newStyle = document.createElement('style');
        newStyle.id='dynamicCssStyle';
        newStyle.textContent = changes[domain].newValue||'';
        document.documentElement.appendChild(newStyle);
      }
    });
  }catch(e){console.error('CSS injection error:', e);}
})();
if (window.top === window.self) {
let inspectMode = false;
let highlightBox;
let tooltipBox;
let lingerTimeout;
function createHighlightBox() {
    highlightBox = document.createElement('div');
    highlightBox.style.position = 'absolute';
    highlightBox.style.background = 'rgba(0, 153, 255, 0.3)';
    highlightBox.style.border = '2px solid #0099ff';
    highlightBox.style.zIndex = '999999';
    highlightBox.style.pointerEvents = 'none';
    document.body.appendChild(highlightBox);
    tooltipBox = document.createElement('div');
    tooltipBox.style.position = 'absolute';
    tooltipBox.style.background = '#0099ff';
    tooltipBox.style.color = '#fff';
    tooltipBox.style.fontSize = '12px';
    tooltipBox.style.padding = '2px 4px';
    tooltipBox.style.borderRadius = '3px';
    tooltipBox.style.zIndex = '1000000';
    tooltipBox.style.pointerEvents = 'none';
    document.body.appendChild(tooltipBox);
}
function startInspectMode() {
    if (inspectMode) return;
    inspectMode = true;
    createHighlightBox();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('click', onClickElement, true);
}
function stopInspectMode(removeTooltip = true) {
    inspectMode = false;
    if (highlightBox) {
        highlightBox.remove();
        highlightBox = null;
    }
    if (removeTooltip && tooltipBox) {
        tooltipBox.remove();
        tooltipBox = null;
    }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('click', onClickElement, true);
}
function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === highlightBox || el === tooltipBox) return;
    const rect = el.getBoundingClientRect();
    highlightBox.style.top = rect.top + window.scrollY + 'px';
    highlightBox.style.left = rect.left + window.scrollX + 'px';
    highlightBox.style.width = rect.width + 'px';
    highlightBox.style.height = rect.height + 'px';
    let text = '';
    if (el.id) {
        text = '#' + el.id;
    } else if (el.className && typeof el.className === 'string') {
        text = '.' + el.className.trim().replace(/\s+/g, '.');
    } else {
        text = el.tagName.toLowerCase();
    }
    if (!tooltipBox.dataset.copied) {
        tooltipBox.textContent = "click to copy " + text;
    }
    tooltipBox.style.top = e.pageY + 15 + 'px';
    tooltipBox.style.left = e.pageX + 15 + 'px';
}
function onClickElement(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === highlightBox) return;
    let text = '';
    if (el.id) text = '#' + el.id;
    else if (el.className && typeof el.className === 'string') text = '.' + el.className.trim().replace(/\s+/g, '.');
    else text = el.tagName.toLowerCase();
    navigator.clipboard.writeText(text).then(() => {
        if (!tooltipBox) {
            tooltipBox = document.createElement('div');
            tooltipBox.style.position = 'absolute';
            tooltipBox.style.background = '#0099ff';
            tooltipBox.style.color = '#fff';
            tooltipBox.style.fontSize = '12px';
            tooltipBox.style.padding = '2px 4px';
            tooltipBox.style.borderRadius = '3px';
            tooltipBox.style.zIndex = '1000000';
            document.body.appendChild(tooltipBox);
        }
        tooltipBox.textContent = `"${text}" copied to clipboard!`;
        tooltipBox.dataset.copied = "true";
        tooltipBox.style.top = e.pageY + 15 + 'px';
        tooltipBox.style.left = e.pageX + 15 + 'px';
        stopInspectMode(false);
        clearTimeout(lingerTimeout);
        lingerTimeout = setTimeout(() => {
            if (tooltipBox) {
                tooltipBox.remove();
                tooltipBox = null;
            }
        }, 3000);
    });
}
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_INSPECT') {
        startInspectMode();
    }
});
}