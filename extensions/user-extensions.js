"use strict";

/**
 * UNSUPPORTED EXPERIMENTAL FEATURE: WD user extensions. MAY CHANGE AT ANY TIME!
 * CURRENTLY USES FUNCTIONALITY NOT YET MERGED INTO NODE-WD-SYNC.
 *
 * This file can be imported as user extensions in the Selenium IDE, and as
 * converter extensions in selenium-html-js-converter.
 *
 * Add your Selenium commands for the IDE, and their equivalent WD functions to
 * the Node.js module.exports hash. The converter looks for the Selenese command
 * name when parsing, so don't use Selenese 'doSomething' style, use 'something'
 * instead (see examples below).
 *
 * In this early experimental version, methods exposed via module.exports will
 * be called with the original two Selenese string arguments "target" and
 * "value", and - if either or both of these arguments is a locator - one or two
 * functions which, when called, uses the wd browser object to return the DOM
 * element matching that locator. The reason it is a function and not the DOM
 * element itself, is in order to support custom commands that must wait for an
 * elements to appear in the DOM.
 *
 * WD functions are included with the generated js cases.
 *
 * FYI: Example functions here do not attempt support for IE8 and lower.
 *
 * Inspiration:
 *   https://raw.githubusercontent.com/refactoror/SelBlocks/master/user-extensions.js
 *
 */

/* We should be loadable in Node.js as well as the Selenium IDE, so don't assume that neither [module] nor [Selenium] is defined: */
if (typeof module === 'undefined') {
  var module = { exports: {} };
}
if (typeof Selenium === 'undefined') {
  var Selenium = function () {};
}



/**
 * Attempts to resize the currently focused window using window.resizeTo().
 *
 * Pass width and height dimensions via the "target" argument. Any non-numerical
 * value is used as separator, so "800 600", "800, 600", or "800 bingo 600" are
 * all valid arguments.
 *
 * NOTE: This won't work on the majority of browsers unless you've previously
 * opened, selected, and focused a popup window (or enabled very lax security
 * settings). This extension was created to translate into webdriver-lingo later
 * on.
 *
 * @param  {string} target Dimensions, as described above.
 * @param  {void}   value  [not used]
 * @return {void}
 */
Selenium.prototype.doSetWindowSize = function (target, value) {
  var dimensions = target.split(/[^0-9]+/);

  this.browserbot.getCurrentWindow().resizeTo(dimensions[0], dimensions[1]);
};



/**
 * Custom command used in Nosco to wait for a page and all resources to load.
 *
 * @throws   on element not found
 *
 * @version  2016-04-21
 * @since    2016-04-21
 *
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doWaitForNoscoPageToLoad = function () {
  this.doWaitForPageToLoad();
  return this.doWaitForCondition('selenium.isElementPresent("css=body.loaded")', this.defaultTimeout);
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @throws   on error bubbles
 *
 * @version  2016-04-21
 * @since    2016-04-21
 *
 * @return   {void}
 */
module.exports.waitForNoscoPageToLoad = function () {
  waitForPageToLoad(browser);
  waitFor(function() {
      return browser.hasElementByCssSelector("body.loaded");
  }, 'browser.hasElementByCssSelector("body.loaded")');
};



/**
 * Custom command that combines waitForElementPresent and waitForVisible.
 *
 * @throws   on element not found
 *
 * @version  2017-01-16
 * @since    2016-04-21
 *
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doWaitForElementPresentAndVisible = function (locator) {
  /* We have to make sure we escape quotes! D'oh! */
  locator = locator.replace(/"/g, '\\"');
  return this.doWaitForCondition('selenium.isElementPresent("'+locator+'") ' +
                                 '&& selenium.isVisible("'+locator+'")',
                                 this.defaultTimeout);
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @throws   on element not presenting, or not becoming visible after doing so.
 *
 * @version  2016-04-21
 * @since    2016-04-21
 *
 * @param    {string}    target   Selenese <target> attribute value
 * @param    {string}    value    Selenese <value> attribute value (ignored)
 * @param    {function}  element  function returning <target> as wd-sync browser
 *                                element if <target> is a locator and the
 *                                element exists, undefined if not a locator.
 * @return   {void}
 */
module.exports.waitForElementPresentAndVisible = function (target, value, element) {
  /* We may already be wrapped in a withRetry, but if we are it doesn't change the overall amount of time being spent before finally giving up. And if we're not, we'd not be waiting if we didn't wrap it, so: */
  withRetry(function () {
    var wdElement = element();
    if (!wdElement || !wdElement.isDisplayed())
      throw new Error ('Element did not appear');
  });
};




/**
 * Custom command used in Nosco to quickly authorize as a given user, and
 * optionally navigate to  a specified URL on success. If started on a non-test
 * site URL, it first navigates either to the specified URL on the baseUrl test
 * site, or if left out, to the baseUrl itself. If we ultimately find ourselves
 * on the login page after successful instaAuth, we navigate to baseUrl as well.
 *
 * Note that if run on an open login page with a ?ref= in the current location,
 * it will perform slower and/or weirdly (if the ?ref targets /logout/reset),
 * since the API server will pick up the ref and redirect to it within the
 * javascript POST call.
 *
 * @version  2017-01-18
 * @since    2017-01-12
 *
 * @param    {string}    creds    email:pwd string
 * @param    {string}    url      optional url to open upon successful auth
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doInstaAuth = function (creds, url) {
  creds = creds.split(':');
  url   = url || '';

  var freq    = 50;
  var bot     = selenium.browserbot;
  var baseUrl = selenium.browserbot.baseUrl;
  var onSite  = new RegExp('^' + baseUrl);
  var atLogin = new RegExp('^' + baseUrl + (baseUrl[baseUrl.length-1] === '/' ? 'login' : '/login'));
  var self    = this;

  if (url !== '') {
    if (url.match(/^\//)) {
      url = baseUrl.replace(/\/$/, '') + url;
    } else if (!onSite.test(url)) {
      throw new Error('Target, "'+url+'", not on base URL, "'+baseUrl);
    }
  }

  function ensureNoscoUrl (target, callback) {
    var location = bot.getCurrentWindow().document.location;

    // We only redirect when either:
    //   *) We're not on the test site at all
    //   *) We have an explicit target which isn't where we are
    if (onSite.test(location.href) && (!target || target === location.href))
      return callback();

    bot.getCurrentWindow().document.body.className =
      (bot.getCurrentWindow().document.body.className || '').
      replace(/(^| )loaded($| )/, ' ');

    location.href = target || baseUrl;

    var timeLeft = self.defaultTimeout;
    var iv = setInterval(function () {
      if (timeLeft <= 0) {
        clearInterval(iv);
        return callback(new Error('Timed out trying to reach the test site'));
      }

      timeLeft -= freq;

      try {
        if (bot.getCurrentWindow().document.body.className.match(/(^| )loaded($| )/)
            && typeof bot.getCurrentWindow().$ === 'function') {
          clearInterval(iv);
          return callback();
        }
      } catch (ignored) {}
    }, freq);
  }

  function logIn (email, pwd, callback) {
    selenium.doRunScript(
      "document.body.className = document.body.className.replace(/(^| )(not-)?logged-in($| )/g, ' ');" +
      "$.post('/login', { email: '"+email+"', password: '"+pwd+"' }).always(function () {" +
      "  if (document.cookie.match(/socketToken/))" +
      "      $('body').addClass('logged-in');" +
      "  else" +
      "      $('body').addClass('not-logged-in');" +
      "});"
    );

    var timeLeft = self.defaultTimeout;
    var iv = setInterval(function () {
      if (timeLeft <= 0) {
        clearInterval(iv);
        return callback(new Error('Timed out waiting for login response'));
      }

      timeLeft -= freq;

      try {
        if (bot.getCurrentWindow().document.body.className.match(/(^| )logged-in($| )/)) {
          clearInterval(iv);
          return callback();
        }
        if (bot.getCurrentWindow().document.body.className.match(/(^| )not-logged-in($| )/)) {
          clearInterval(iv);
          return callback(new Error('Login failed'));
        }
      } catch (ignored) {}
    }, freq);
  }

  ensureNoscoUrl(false, function (err) {
    if (err) {
      throw err;
      return;
    }
    self.doDeleteAllVisibleCookies();
    logIn(creds[0], creds[1], function (err) {
      if (err) {
        throw err;
        return;
      }
      var curUrl = bot.getCurrentWindow().document.location.href;
      if ((!url || curUrl === url) && !atLogin.test(curUrl)) {
        bot.getCurrentWindow().document.body.className += " insta-logged-in";
        return;
      }
      ensureNoscoUrl(url || baseUrl, function (err) {
        if (err) {
          throw err;
          return;
        }
        bot.getCurrentWindow().document.body.className += " insta-logged-in";
      });
    });
  });

  selenium.doRunScript("document.body.className = document.body.className.replace(/(^| )insta-logged-in($| )/, ' ');");
  return this.doWaitForCondition('selenium.isElementPresent("css=body.insta-logged-in")', this.defaultTimeout);
}
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @version  2017-01-16
 * @since    2017-01-12
 *
 * @note     Requires wd-sync-raw or pull request
 *           https://github.com/sebv/node-wd-sync/pull/30 to be merged to
 *           vanilla wd-sync.
 *
 * @param    {string}    creds    Selenese <target> attribute value; usr:pwd
 * @param    {string}    url      Selenese <value> attribute value; target url
 * @param    {function}  element  function returning <target> as wd-sync browser
 *                                element if <target> is a locator and the
 *                                element exists, undefined if not a locator.
 * @return   {void}
 */
module.exports.instaAuth = function (creds, url, element) {
  var baseUrl = options.baseUrl;
  var onSite  = new RegExp('^' + baseUrl);
  var atLogin = new RegExp('^' + baseUrl + (baseUrl[baseUrl.length-1] === '/' ? 'login' : '/login'));

  url         = url || '';

  if (url !== '') {
    if (url.match(/^\//)) {
      url = baseUrl.replace(/\/$/, '') + url;
    } else if (!onSite.test(url)) {
      throw new Error('Target, "'+url+'", not on base URL, "'+baseUrl);
    }
  }

  if (!onSite.test(location.href)) {
    browser.get(url || baseUrl);
    waitForNoscoPageToLoad();
  }

  browser.execute(functionBody(function () {
    var email = arguments[0];
    var pwd   = arguments[0];
    $('body').removeClass('not-logged-in logged-in');
    $.post('/login', { email: email, password: pwd }).always(function () {
      if (document.cookie.match(/socketToken/))
          $('body').addClass('logged-in');
    });
  }), creds.split(':'));

  waitFor(function() {
      return browser.hasElementByCssSelector("body.logged-in");
  }, 'browser.hasElementByCssSelector("body.logged-in")');

  if ((url && location.href !== url) || atLogin.test(location.href)) {
    browser.get(url || baseUrl);
    waitForNoscoPageToLoad();
  }
};




/**
 * Custom command used in Nosco to open a URL if not running on the base url,
 * or if at the logout/reset special page.
 *
 * If no URL is provided, baseUrl is used.
 *
 * @version  2017-01-18
 * @since    2017-01-12
 *
 * @param    {string}    url      optional url to open if not already on baseUrl
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doEnsureNoscoUrl = function (url) {
  var bot      = selenium.browserbot;
  var baseUrl  = bot.baseUrl;
  var onSite   = new RegExp('^' + baseUrl);
  var atReset  = new RegExp('^' + baseUrl + (baseUrl[baseUrl.length-1] === '/' ? 'logout/reset' : '/logout/reset'));
  var location = selenium.browserbot.getCurrentWindow().document.location;

  if (!onSite.test(location.href) || atReset.test(location.href)) {
    var target = url || baseUrl;

    if (target && target.match(/^\//)) {
      target = baseUrl.replace(/\/$/, '') + target;
    } else if (!onSite.test(target)) {
      throw new Error('Target, "'+target+'", not on base URL, "'+baseUrl);
    }

    bot.getCurrentWindow().document.body.className =
      (bot.getCurrentWindow().document.body.className || '').
      replace(/(^| )loaded($| )/, ' ');

    location.href = target;

    return this.doWaitForNoscoPageToLoad();
  }
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @throws   on target URL not on baseUrl.
 *
 * @version  2017-01-18
 * @since    2017-01-12
 *
 * @note     Requires wd-sync-raw or pull request
 *           https://github.com/sebv/node-wd-sync/pull/30 to be merged to
 *           vanilla wd-sync.
 *
 * @param    {string}    target   Selenese <target> attribute value; url
 * @param    {string}    value    Selenese <value> attribute value
 * @param    {function}  element  function returning <target> as wd-sync browser
 *                                element if <target> is a locator and the
 *                                element exists, undefined if not a locator.
 * @return   {void}
 */
module.exports.ensureNoscoUrl = function (target, value, element) {
  /* .execute takes just a function body as a string to be eval'ed: */
  browser.execute(functionBody(function () {
    var target  = arguments[0];
    var baseUrl = options.baseUrl;
    var onSite  = new RegExp('^' + baseUrl);
    var atReset = new RegExp('^' + baseUrl + (baseUrl[baseUrl.length-1] === '/' ? 'logout/reset' : '/logout/reset'));

    if (!onSite.test(location.href)) {
      var target = arguments[0] || baseUrl;

      if (target && target.match(/^\//)) {
        target = baseUrl.replace(/\/$/, '') + target;
      } else if (!onSite.test(target)) {
        throw new Error('Target, "'+target+'", not on base URL, "'+baseUrl);
      }

      $('body').removeClass('loaded');

      location.href = target;
    }
  }), [target]);

  waitFor(function() {
      return browser.hasElementByCssSelector("body.loaded");
  }, 'browser.hasElementByCssSelector("body.loaded")');
};




/**
 * Custom command used in Nosco to click and wait for a page and all resources
 * to load.
 *
 * @throws   on element not found
 *
 * @version  2016-11-23
 * @since    2016-04-21
 *
 * @param    {string}    locator  Element locator
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doClickAndNoscoWait = function (locator) {
  this.doRunScript("document.body.className = document.body.className.replace(/(^| )loaded($| )/, ' ');");
  this.doClick(locator);
  this.doWaitForPageToLoad();
  return this.doWaitForCondition('selenium.isElementPresent("css=body.loaded")', this.defaultTimeout);
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @throws   on raw element not implementing .click()
 *
 * @version  2016-11-23
 * @since    2016-04-21
 *
 * @note     Requires wd-sync-raw or pull request
 *           https://github.com/sebv/node-wd-sync/pull/30 to be merged to
 *           vanilla wd-sync.
 *
 * @param    {string}    target   Selenese <target> attribute value
 * @param    {string}    value    Selenese <value> attribute value (ignored)
 * @param    {function}  element  function returning <target> as wd-sync browser
 *                                element if <target> is a locator and the
 *                                element exists, undefined if not a locator.
 * @return   {void}
 */
module.exports.clickAndNoscoWait = function (target, value, element) {
  /* .execute takes just a function body as a string to be eval'ed: */
  browser.execute(functionBody(function () {
    var element = arguments[0];
    var target  = arguments[1];

    if (typeof element.click !== 'function')
      throw new Error('Element at ' + target + ' does not have a .click() method');

    document.body.className = document.body.className.replace(/(^| )loaded($| )/, ' ');

    element.click();
  }), [element().rawElement /* Important! element is mangled by wd-sync; we need the raw wd element */, target]);

  waitFor(function() {
      return browser.hasElementByCssSelector("body.loaded");
  }, 'browser.hasElementByCssSelector("body.loaded")');
};



/**
 * Custom command used in Nosco to first focus an element (to assure its
 * visibility inside the viewport) and then click it.
 *
 * If the second argument (i.e. the "value" argument) is also specified, it is
 * assumed to be a locator to let a different element from the one being focused
 * be the target of the click command.
 *
 * Why? Because Selenium is weird and sometimes just moves the viewport close
 * to the element you're trying to reveal, but does not actually reveal it.
 *
 * @throws   on element not found
 *
 * @version  2016-05-04
 * @since    2016-05-03
 *
 * @param    {string}    focus    Element locator to focus and click
 * @param    {string}    click    Optional element locator to click instead
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doFocusAndClick = function (focus, click) {
  this.doFocus(focus);
  this.doClick(click || focus);
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @throws   on raw element not implementing .click()
 *
 * @version  2016-05-04
 * @since    2016-05-03
 *
 * @note     Requires wd-sync-raw or pull request
 *           https://github.com/sebv/node-wd-sync/pull/30 to be merged to
 *           vanilla wd-sync.
 *
 * @param    {string}    target   Selenese <target> attribute value
 * @param    {string}    value    Selenese <value> attribute value (ignored)
 * @param    {function}  element  function returning <target> as wd-sync browser
 *                                element if <target> is a locator and the
 *                                element exists, undefined if not a locator.
 * @param    {function}  element2 function returning <value> as wd-sync browser
 *                                element if <value> is a locator and the
 *                                element exists, undefined if not a locator.
 * @return   {void}
 */
module.exports.focusAndClick = function (focusLocator, clickLocator, focusElement, clickElement) {
  browser.execute(functionBody(function () {
    var elToFocus = arguments[0];
    var elToClick = arguments[1];
    var focusLocator = arguments[2];
    var clickLocator = arguments[3];

    if (typeof elToFocus.focus !== 'function')
      throw new Error('Element at ' + focusLocator + ' does not have a .focus() method');

    if (typeof elToClick.focus !== 'function')
      throw new Error('Element at ' + clickLocator + ' does not have a .click() method');

    elToFocus.focus();
    elToClick.click();
  }), [
    focusElement().rawElement,
    (clickElement || focusElement)().rawElement,
    focusLocator,
    (clickLocator || focusLocator)
  ]);
};



/**
 * Custom command used to clear local storage.
 *
 * @version  2017-01-19
 * @since    2017-01-19
 *
 * @return   {void}
 */
Selenium.prototype.doClearLocalStorage = function () {
  selenium.browserbot.getCurrentWindow().localStorage.clear();
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @version  2017-01-19
 * @since    2017-01-19
 *
 * @return   {void}
 */
module.exports.clearLocalStorage = function () {
  browser.execute('window.localStorage.clear();');
};



/**
 * Funky hack to do sendKeys-ish typing on a Redactor editor (possibly other
 * contenteditable-based RTEs as well ).
 *
 * @throws   on element not found
 *
 * @version  2016-03-07
 * @since    2016-02-25
 *
 * @note     introduces a 100 msec delay (needed to allow Redactor to react on
 *           and process events)
 *
 * @param    {string}    locator  Element locator
 * @param    {string}    text     The text to put in
 * @return   {function}           doWaitForCondition instance
 */
Selenium.prototype.doTypeRedactor = function (locator, text) {
  var element = this.page().findElement(locator);
  var self = this;
  selenium._typedRedactor = false;

  self.doKeyDown(locator, '\\0');
  self.doKeyUp(locator, '\\0');
  element.innerHTML = 'redactor';
  setTimeout(function () {
    self.doKeyDown(locator, '\\0');
    self.doKeyUp(locator, '\\0');
    element.innerHTML = text;
    setTimeout(function () {
      self.doKeyDown(locator, '\\0');
      self.doKeyUp(locator, '\\0');
      selenium._typedRedactor = true;
    }, 50);
  }, 50);

  return this.doWaitForCondition("selenium._typedRedactor", this.defaultTimeout);
};
/**
 * wd-sync version of the above which will be included with generated tests.
 *
 * @throws   on error bubbles
 *
 * @version  2016-03-04
 * @since    2016-03-04
 *
 * @todo     Figure out why executeAsync doesn't return and get rid of className
 *           hack.
 * @note     Requires wd-sync-raw or pull request
 *           https://github.com/sebv/node-wd-sync/pull/30 to be merged to
 *           vanilla wd-sync.
 * @note     There's something odd going on with .executeAsync in node-wd-sync.
 *           We should be able to use it in a synchronous fashion to pick up
 *           callback return values directly, à la
 *             var a = browser.executeAsync('runAndCallBack()', [args], null);
 *           — we do get a callback function passed, but calling it doesn't
 *           make .executeAsync complete. We simply time out. I may just be
 *           retarded here, but in either case, for now, we hack it like this.
 *
 * @param    {string}    target   Selenese <target> attribute value
 * @param    {string}    value    Selenese <value> attribute value
 * @param    {function}  element  function returning <target> as wd-sync browser
 *                                element if <target> is a locator and the
 *                                element exists, undefined if not a locator.
 * @return   {void}
 */
module.exports.typeRedactor = function (target, value, element) {
  /* .execute takes just a function body as a string to be eval'ed: */
  var className = browser.execute(functionBody(function () {
    var element = arguments[0];
    var text = arguments[1];
    var callback = arguments[2];
    /* Once done, we tag redactor with a class, so we know when we finished: */
    var className = "seleniumDoTypeRedactor-" + (new Date()).getTime();
    var keyEvent = function (element, event, keyCode) {
        var ev = window.document.createEvent('KeyboardEvent');
        if (ev.initKeyEvent)
            ev.initKeyEvent(event, true, true, window, 0, 0, 0, 0, 0, keyCode);
        else
            ev.initKeyboardEvent(event, true, true, window, 0, 0, 0, 0, 0, keyCode);
        return element.dispatchEvent(ev);
    };
    keyEvent(element, 'keydown', 0);
    keyEvent(element, 'keyup', 0);
    element.textContent = 'redactor';
    setTimeout(function () {
      keyEvent(element, 'keydown', 0);
      keyEvent(element, 'keyup', 0);
      element.textContent = text;
      setTimeout(function () {
        keyEvent(element, 'keydown', 0);
        keyEvent(element, 'keyup', 0);
        element.className += ' ' + className;
      }, 50);
    }, 50);
    return className;
  }), [element().rawElement /* Important! element is mangled by wd-sync; we need the raw wd element */, value]);
  waitFor(function () {
    return browser.hasElementByCssSelector('.' + className);
  }, 'browser.hasElementByCssSelector(".' + className + '") [to mark completion of typeRedactor execution]');
};
