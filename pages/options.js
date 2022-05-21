const selectProtocolInput = protocol => {
  const protocolInput = document.querySelector(`.js-protocol-input[value="${protocol}"]`);
  if (protocolInput) {
    protocolInput.checked = true;
  }
};

const initActiveToolIdsChecked = tools => {
  const body = document.querySelector('#active-ide-tool-list');
  const template = document.querySelector('template');
  let listStr = '';
  tools.forEach(item => {
    listStr += template.innerHTML.replaceAll('__icon__', item.icon).
      replaceAll('__tool_name__', item.name).replaceAll('__tool_tag__', item.tag).
      replaceAll('checked="__tool_checked__"', item.checked ? 'checked' : '');
  });
  body.innerHTML += listStr;
  body.addEventListener('change', event => {
    const checkedIds = Array.from(body.querySelectorAll('input:checked')).map(item => item.name);
    if (event.target.tagName === 'INPUT') {
      chrome.runtime.sendMessage({
        type: 'update-active-tool-ids', data: {
          toolIds: checkedIds
        }
      });
    }
  });
};

chrome.runtime.sendMessage({type: 'get-protocol'}, data => {
  selectProtocolInput(data.protocol);
});

chrome.runtime.sendMessage({type: 'get-modify-pages'}, data => {
  const modifyPagesInput = document.querySelector('.js-modify-pages-input');
  modifyPagesInput.checked = data.allow;
});

document.querySelector('.js-protocol-input-group').addEventListener('change', e => {
  chrome.runtime.sendMessage({type: 'save-protocol', protocol: e.target.value});
});

document.querySelector('.js-modify-pages-input').addEventListener('change', e => {
  chrome.runtime.sendMessage({type: 'save-modify-pages', allow: e.target.checked});
});

chrome.runtime.onMessage.addListener(message => {
  switch (message.type) {
    case 'protocol-changed':
      selectProtocolInput(message.newValue);
      break;
    case 'init-active-tool-ids':
      initActiveToolIdsChecked(message.newValue);
      break;
      // no default
  }
});

(() => {
  chrome.runtime.sendMessage({type: 'get-active-tools'});
})();
