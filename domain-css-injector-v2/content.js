function resolveBaseHost(hostname){
  const parts = hostname.split('.').reverse();
  if (parts.length > 2) return parts[1] + '.' + parts[0];
  return hostname;
}
(function(){
  try{
    const host = resolveBaseHost(window.location.hostname);
    chrome.storage.local.get([host], (res)=>{
      if(res[host]){
        const node = document.createElement('style');
        node.id='__ps_kx9w4_style';
        node.textContent = res[host];
        document.documentElement.appendChild(node);
      }
    });
    chrome.storage.onChanged.addListener((changes, areaName)=>{
      if(areaName==='local' && changes[host]){
        const oldNode = document.getElementById('__ps_kx9w4_style');
        if(oldNode) oldNode.remove();
        const nextNode = document.createElement('style');
        nextNode.id='__ps_kx9w4_style';
        nextNode.textContent = changes[host].newValue||'';
        document.documentElement.appendChild(nextNode);
      }
    });
  }catch(e){console.error('style injection error:', e);}
})();
if (window.top === window.self) {
let pickerActive = false;
let pickerFrame;
let pickerLabel;
let pickerLinger;
function buildPickerOverlay() {
    pickerFrame = document.createElement('div');
    pickerFrame.style.position = 'absolute';
    pickerFrame.style.background = 'rgba(0, 153, 255, 0.3)';
    pickerFrame.style.border = '2px solid #0099ff';
    pickerFrame.style.zIndex = '999999';
    pickerFrame.style.pointerEvents = 'none';
    document.body.appendChild(pickerFrame);
    pickerLabel = document.createElement('div');
    pickerLabel.style.position = 'absolute';
    pickerLabel.style.background = '#0099ff';
    pickerLabel.style.color = '#fff';
    pickerLabel.style.fontSize = '12px';
    pickerLabel.style.padding = '2px 4px';
    pickerLabel.style.borderRadius = '3px';
    pickerLabel.style.zIndex = '1000000';
    pickerLabel.style.pointerEvents = 'none';
    document.body.appendChild(pickerLabel);
}
function enterPickerMode() {
    if (pickerActive) return;
    pickerActive = true;
    buildPickerOverlay();
    document.addEventListener('mousemove', onPickerMove);
    document.addEventListener('click', onPickerSelect, true);
}
function exitPickerMode(removeLabel = true) {
    pickerActive = false;
    if (pickerFrame) {
        pickerFrame.remove();
        pickerFrame = null;
    }
    if (removeLabel && pickerLabel) {
        pickerLabel.remove();
        pickerLabel = null;
    }
    document.removeEventListener('mousemove', onPickerMove);
    document.removeEventListener('click', onPickerSelect, true);
}
function onPickerMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === pickerFrame || el === pickerLabel) return;
    const rect = el.getBoundingClientRect();
    pickerFrame.style.top = rect.top + window.scrollY + 'px';
    pickerFrame.style.left = rect.left + window.scrollX + 'px';
    pickerFrame.style.width = rect.width + 'px';
    pickerFrame.style.height = rect.height + 'px';
    let text = '';
    if (el.id) {
        text = '#' + el.id;
    } else if (el.className && typeof el.className === 'string') {
        text = '.' + el.className.trim().replace(/\s+/g, '.');
    } else {
        text = el.tagName.toLowerCase();
    }
    if (!pickerLabel.dataset.copied) {
        pickerLabel.textContent = "click to copy " + text;
    }
    pickerLabel.style.top = e.pageY + 15 + 'px';
    pickerLabel.style.left = e.pageX + 15 + 'px';
}
function onPickerSelect(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === pickerFrame) return;
    let text = '';
    if (el.id) text = '#' + el.id;
    else if (el.className && typeof el.className === 'string') text = '.' + el.className.trim().replace(/\s+/g, '.');
    else text = el.tagName.toLowerCase();
    navigator.clipboard.writeText(text).then(() => {
        if (!pickerLabel) {
            pickerLabel = document.createElement('div');
            pickerLabel.style.position = 'absolute';
            pickerLabel.style.background = '#0099ff';
            pickerLabel.style.color = '#fff';
            pickerLabel.style.fontSize = '12px';
            pickerLabel.style.padding = '2px 4px';
            pickerLabel.style.borderRadius = '3px';
            pickerLabel.style.zIndex = '1000000';
            document.body.appendChild(pickerLabel);
        }
        pickerLabel.textContent = `"${text}" copied to clipboard!`;
        pickerLabel.dataset.copied = "true";
        pickerLabel.style.top = e.pageY + 15 + 'px';
        pickerLabel.style.left = e.pageX + 15 + 'px';
        exitPickerMode(false);
        clearTimeout(pickerLinger);
        pickerLinger = setTimeout(() => {
            if (pickerLabel) {
                pickerLabel.remove();
                pickerLabel = null;
            }
        }, 3000);
    });
}
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PS_START_PICK') {
        enterPickerMode();
    }
});
}
