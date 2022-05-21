import 'whatwg-fetch';
import {observe} from 'selector-observer';

import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_TOOLS,
  USAGE_THRESHOLD,
  DEFAULT_LANGUAGE,
  DEFAULT_LANGUAGE_SET,
  CLONE_PROTOCOLS
} from './constants';

import {
  getToolboxURN,
  getToolboxNavURN,
  callToolbox, filterToolsByActive
} from './api/toolbox';

// eslint-disable-next-line import/no-commonjs
const gh = require('gitee-url-to-object');

const CLONE_BUTTON_GROUP_JS_CSS_CLASS = 'js-toolbox-clone-button-group';
const OPEN_BUTTON_JS_CSS_CLASS = 'js-toolbox-open-button';
const OPEN_MENU_ITEM_JS_CSS_CLASS = 'js-toolbox-open-menu-item';

const fetchMetadata = () => new Promise((resolve, reject) => {
  const metadata = gh(window.location.toString(), {enterprise: true});
  if (metadata) {
    resolve(metadata);
  } else {
    reject();
  }
});

const extractLanguagesFromPage = githubMetadata => new Promise(resolve => {
  // TBX-4762: private repos don't let use API, load root page and scrape languages off it
  fetch(githubMetadata.clone_url).then(response => response.text()).then(htmlString => {
    const parser = new DOMParser();
    const htmlDocument = parser.parseFromString(htmlString, 'text/html');
    const languageElements = htmlDocument.querySelectorAll('div[class="lang"] a');
    const allLanguages = Array.from(languageElements).reduce((acc, el) => {
      acc[el.textContent.toLowerCase()] = USAGE_THRESHOLD + 1;
      return acc;
    }, {});
    resolve(allLanguages);
  }).catch(() => {
    resolve(DEFAULT_LANGUAGE_SET);
  });
});

const fetchLanguages = githubMetadata => new Promise(resolve => {
  extractLanguagesFromPage(githubMetadata).then(resolve);
});

const selectTools = languages => new Promise(resolve => {
  const overallPoints = Object.
    values(languages).
    reduce((overall, current) => overall + current, 0);

  const filterLang = language =>
    SUPPORTED_LANGUAGES[language.toLowerCase()] && languages[language] / overallPoints > USAGE_THRESHOLD;

  const selectedToolIds = Object.
    keys(languages).
    filter(filterLang).
    reduce((acc, key) => {
      acc.push(...SUPPORTED_LANGUAGES[key.toLowerCase()]);
      return acc;
    }, []);

  const normalizedToolIds = selectedToolIds.length > 0
    ? Array.from(new Set(selectedToolIds))
    : SUPPORTED_LANGUAGES[DEFAULT_LANGUAGE];

  const tools = normalizedToolIds.
    sort().
    map(toolId => SUPPORTED_TOOLS[toolId]);
  filterToolsByActive(tools).then(resolve);
});

const fetchTools = githubMetadata => fetchLanguages(githubMetadata).then(selectTools);

const getHttpsCloneUrl = githubMetadata => `${githubMetadata.clone_url}.git`;
const getSshCloneUrl =
  githubMetadata => `git@${githubMetadata.host}:${githubMetadata.user}/${githubMetadata.repo}.git`;

let handleMessage = null;

const renderPageAction = githubMetadata => new Promise(resolve => {
  if (handleMessage && chrome.runtime.onMessage.hasListener(handleMessage)) {
    chrome.runtime.onMessage.removeListener(handleMessage);
  }
  handleMessage = (message, sender, sendResponse) => {
    switch (message.type) {
      case 'get-tools':
        fetchTools(githubMetadata).then(sendResponse);
        return true;
      case 'perform-action':
        const toolboxAction = getToolboxURN(message.toolTag, message.cloneUrl);
        callToolbox(toolboxAction);
        break;
      // no default
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(handleMessage);

  resolve();
});

const removeCloneButtons = () => {
  const cloneButtonGroup = document.querySelector(`.${CLONE_BUTTON_GROUP_JS_CSS_CLASS}`);
  if (cloneButtonGroup) {
    cloneButtonGroup.parentElement.removeChild(cloneButtonGroup);
  }
};

const addCloneButtonEventHandler = (btn, githubMetadata) => {
  btn.addEventListener('click', e => {
    e.preventDefault();

    const {toolTag} = e.currentTarget.dataset;
    chrome.runtime.sendMessage({type: 'get-protocol'}, ({protocol}) => {
      const cloneUrl = protocol === CLONE_PROTOCOLS.HTTPS
        ? getHttpsCloneUrl(githubMetadata)
        : getSshCloneUrl(githubMetadata);
      const action = getToolboxURN(toolTag, cloneUrl);
      callToolbox(action);
    });
  });
};

const createCloneButton = (tool, githubMetadata, small = true) => {
  const button = document.createElement('a');
  button.setAttribute(
    'class',
    `button ${small ? 'btn-sm' : ''} ui gradient BtnGroup-item d-flex`
  );
  button.setAttribute('href', '#');
  button.setAttribute('title', `Clone in ${tool.name}`);
  button.setAttribute('style', 'align-items:center');
  button.dataset.toolTag = tool.tag;

  const buttonIcon = document.createElement('img');
  buttonIcon.setAttribute('alt', tool.name);
  buttonIcon.setAttribute('src', tool.icon);
  buttonIcon.setAttribute('width', '17');
  buttonIcon.setAttribute('height', '17');
  buttonIcon.setAttribute('style', 'vertical-align:text-top');
  button.appendChild(buttonIcon);

  addCloneButtonEventHandler(button, githubMetadata);

  return button;
};

const renderCloneButtons = (tools, githubMetadata) => {
  const getRepoController = document.querySelector('.git-project-right-actions');
  if (getRepoController) {
    const toolboxCloneButtonGroup = document.createElement('div');
    const isOnPullRequestsTab = document.querySelector('#pull-requests-tab[aria-current="page"]');
    toolboxCloneButtonGroup.setAttribute(
      'class',
      `BtnGroup pull-right ${isOnPullRequestsTab ? 'ml-1' : 'mr-2'} d-flex ${CLONE_BUTTON_GROUP_JS_CSS_CLASS}`
    );
    tools.forEach(tool => {
      const btn = createCloneButton(tool, githubMetadata, false);
      toolboxCloneButtonGroup.appendChild(btn);
    });

    getRepoController.insertAdjacentElement('afterend', toolboxCloneButtonGroup);
  }

};

const addOpenButtonEventHandler = (domElement, tool, githubMetadata) => {
  domElement.addEventListener('click', e => {
    e.preventDefault();

    const {user, repo, branch} = githubMetadata;
    const normalizedBranch = branch.split('/').shift();
    const filePath = location.pathname.replace(`/${user}/${repo}/blob/${normalizedBranch}/`, '');
    let lineNumber = location.hash.replace('#L', '');
    if (lineNumber === '') {
      lineNumber = null;
    }

    callToolbox(getToolboxNavURN(tool.tag, repo, filePath, lineNumber));
  });
};

// when navigating with back and forward buttons
// we have to re-create open actions b/c their click handlers got lost somehow
const removeOpenButtons = () => {
  const actions = document.querySelectorAll(`.${OPEN_BUTTON_JS_CSS_CLASS}`);
  actions.forEach(action => {
    action.parentElement.removeChild(action);
  });

  const menuItems = document.querySelectorAll(`.${OPEN_MENU_ITEM_JS_CSS_CLASS}`);
  menuItems.forEach(item => {
    item.parentElement.removeChild(item);
  });
};

const removePageButtons = () => {
  removeCloneButtons();
  removeOpenButtons();
};

const createOpenButton = (tool, githubMetadata) => {
  const action = document.createElement('a');
  action.setAttribute('class', `btn-octicon tooltipped tooltipped-nw ${OPEN_BUTTON_JS_CSS_CLASS}`);
  action.setAttribute('aria-label', `Open this file in ${tool.name}`);
  action.setAttribute('href', '#');

  const actionIcon = document.createElement('img');
  actionIcon.setAttribute('alt', tool.name);
  actionIcon.setAttribute('src', tool.icon);
  actionIcon.setAttribute('width', '16');
  actionIcon.setAttribute('height', '16');
  action.appendChild(actionIcon);

  addOpenButtonEventHandler(action, tool, githubMetadata);

  return action;
};

const createOpenMenuItem = (tool, first, githubMetadata) => {
  const menuItem = document.createElement('a');
  menuItem.setAttribute('class', 'dropdown-item');
  menuItem.setAttribute('role', 'menu-item');
  menuItem.setAttribute('href', '#');
  if (first) {
    menuItem.style.borderTop = '1px solid #eaecef';
  }
  menuItem.textContent = `Open in ${tool.name}`;

  addOpenButtonEventHandler(menuItem, tool, githubMetadata);
  menuItem.addEventListener('click', () => {
    const blobToolbar = document.querySelector('.BlobToolbar');
    if (blobToolbar) {
      blobToolbar.removeAttribute('open');
    }
  });

  const menuItemContainer = document.createElement('li');
  menuItemContainer.setAttribute('class', OPEN_MENU_ITEM_JS_CSS_CLASS);
  menuItemContainer.appendChild(menuItem);

  return menuItemContainer;
};

const renderOpenButtons = (tools, githubMetadata) => {
  const actionAnchorElement = document.querySelector('.repository-content .Box-header .BtnGroup + div');
  const actionAnchorFragment = document.createDocumentFragment();
  const blobToolbarDropdown = document.querySelector('.BlobToolbar-dropdown');

  tools.forEach((tool, toolIndex) => {
    if (actionAnchorElement) {
      const action = createOpenButton(tool, githubMetadata);
      actionAnchorFragment.appendChild(action);
    }
    if (blobToolbarDropdown) {
      const menuItem = createOpenMenuItem(tool, toolIndex === 0, githubMetadata);
      blobToolbarDropdown.appendChild(menuItem);
    }
  });
  if (actionAnchorElement) {
    actionAnchorElement.prepend(actionAnchorFragment);
  }
};

const renderPageButtons = githubMetadata => {
  fetchTools(githubMetadata).
    then(tools => {
      renderCloneButtons(tools, githubMetadata);
      renderOpenButtons(tools, githubMetadata);
    }).
    catch(() => {
      // do nothing
    });
};

const startTrackingDOMChanges = githubMetadata =>
  observe('.git-project-right-actions', {
    add() {
      removePageButtons();
      renderPageButtons(githubMetadata);
    },
    remove() {
      removePageButtons();
    }
  });

const stopTrackingDOMChanges = observer => {
  if (observer) {
    observer.abort();
  }
};

const enablePageAction = githubMetadata => {
  chrome.runtime.sendMessage({
    type: 'enable-page-action',
    project: githubMetadata.repo,
    https: getHttpsCloneUrl(githubMetadata),
    ssh: getSshCloneUrl(githubMetadata)
  });
};

const disablePageAction = () => {
  chrome.runtime.sendMessage({type: 'disable-page-action'});
};

const toolboxify = () => {
  fetchMetadata().
    then(metadata => {
      renderPageAction(metadata).then(() => {
        enablePageAction(metadata);
      });

      chrome.runtime.sendMessage({type: 'get-modify-pages'}, data => {
        let DOMObserver = null;
        if (data.allow) {
          DOMObserver = startTrackingDOMChanges(metadata);
        }
        chrome.runtime.onMessage.addListener(message => {
          switch (message.type) {
            case 'modify-pages-changed':
              if (message.newValue) {
                DOMObserver = startTrackingDOMChanges(metadata);
              } else {
                stopTrackingDOMChanges(DOMObserver);
              }
              break;
            // no default
          }
        });
      });
    }).
    catch(() => {
      disablePageAction();
    });
};

export default toolboxify;
