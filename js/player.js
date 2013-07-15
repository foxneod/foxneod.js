/*global define, FDM_Player */

define(['require',
    'ovp',
    'player/Iframe',
    'player/playback',
    'modal',
    'Debug',
    'jqueryloader',
    'underscoreloader',
    'Dispatcher',
    'query',
    'utils'
], function (require, ovp, Iframe, playback, modal, Debug, jquery, _, Dispatcher, query, utils) {
    'use strict';

    var debug = new Debug('player'),
        dispatcher = new Dispatcher(),
        _currentVideo = {},
        _mostRecentAd = {},
        _players = [],
        _currentPosition,
        _promisesQueue = [],
        _playerIndex = 0;

    //---------------------------------------------- private methods
    function _enableExternalController (enableScriptTag, enableMetaTag) {
        var attributes = {
            name: "tp:EnableExternalController",
            content: "true"
        };

        if (!utils.tagInHead('script', attributes) && enableMetaTag)
        {
            utils.addToHead('meta', attributes);
            debug.log('external controller (meta tag) added');
        }
        else
        {
            debug.log('Page already has external controller meta tag');
        }

        attributes = {
            type: 'text/javascript',
            src: '@@ovpAssetsFilePath' + 'pdk/tpPdkController.js'
        };

        if (!utils.tagInHead('script', attributes) && enableScriptTag)
        {
            utils.addToHead('script', attributes);
            debug.log('external controller (script tag) added');
        }
        else
        {
            debug.log('Page already has external controller script tag');
        }
    }

    function _processAttributes(selector, suppliedAttributes, declaredAttributes) {
        var attributes = suppliedAttributes || {};

        if (_.isDefined(declaredAttributes))
        {
            if (_.isTrueObject(attributes) && !_.isEmpty(attributes))
            {
                attributes = utils.override(declaredAttributes || {}, attributes);
            }
            else
            {
                attributes = declaredAttributes;
            }
        }

        /*
         * All of this just makes sure that we get a proper height/width to set on the iframe itself, which is
         * not always the same as the height and width of the player.
         */

        var defaults = {
            width: (_.has(attributes, 'width')) ? attributes.width : 640,
            height: (_.has(attributes, 'height')) ? attributes.height : 360,
            suppliedId: (_.has(attributes, 'suppliedId')) ? attributes.suppliedId : jquery(selector).attr('id'),
            debug: utils.getParamValue('debug')
        };

        attributes.width = defaults.width;
        attributes.height = defaults.height;
        attributes.playerIndex = _playerIndex++;
        attributes.debug = attributes.debug || defaults.debug;
        attributes.suppliedId = defaults.suppliedId;

        return attributes;
    }
    //---------------------------------------------- /private methods



    //---------------------------------------------- public methods
    var setPlayerMessage = function (options) {
        if (_.isObject(options))
        {
            modal.displayModal(options);
        }
        else
        {
            debug.log('setPlayerMessage expected 1 argument: an object of options.', options);
        }
    };

    var clearPlayerMessage = function () {
        modal.remove();
    };

    var getCurrentVideo = function () {
        return _currentVideo;
    };

    var getMostRecentAd = function () {
        return _mostRecentAd;
    };

    var control = function (playerIdSelector) {
        var controllerToUse = getController(playerIdSelector);

        debug.log('setting controller', controllerToUse);
        playback._setController(controllerToUse);

        return playback;
    };

    var getController = function (selector) {
        var elements = jquery(selector),
            controllerToUse = null;

        _.each(elements, function (element) {
            var id = jquery(element).attr('id');

            if (!_.isUndefined(id))
            {
                 _.each(_players, function (player) {
                    debug.log("searching for player controller...");
                    if (player.attributes.suppliedId === id || player.attributes.iframePlayerId === id)
                    {
                        controllerToUse = player.controller;
                    }
                });
            }
        });

        if (!_.isUndefined(controllerToUse) && !_.isEmpty(controllerToUse))
        {
            debug.log('controller to use', controllerToUse);
            return controllerToUse().controller;
        }
        else
        {
            debug.warn("The selector you provided doesn't point to a player on the page");
        }

        debug.log('getController() returning false');
        return false;
    };

    var loadVideo = function (releaseURLOrId, callback) {
        var deferred = jquery.Deferred();
        _promisesQueue.push({
            id: _.removeQueryParams(releaseURLOrId),
            deferred: deferred
        });

        if (!query.isReleaseURL(releaseURLOrId))
        {
            deferred.reject();
            throw new Error("The loadVideo() method expects one argument: a release URL");
        }

        //the 0 second timeout is to handle a bug in the PDK
        //calling it directly alongside other methods causes it to do nothing
        setTimeout(function () {
            debug.log('calling loadReleaseURL()', releaseURLOrId);
            ovp.controller().loadReleaseURL(releaseURLOrId, true); //loads release and replaces default
        }, 0);

        return deferred;
    };

    var getCurrentPosition = function () {
        var details = {
            position: null,
            duration: null,
            percentComplete: null
        };

        if (_.isTrueObject(_currentPosition) && !_.isEmpty(_currentPosition))
        {
            details.position = _currentPosition.currentTime;
            details.duration = _currentPosition.duration;
            details.percentComplete = _currentPosition.percentComplete;
        }

        return details;
    };

    /**
     * Creates a player in the page at the given selector.
     *
     * @param selector {String} Selector string to the HTML element where the player should get created
     * @param config {String|Object} String that points to a default configuration or an object providing
     * the config to use
     * @returns {Object} Returns the final config object
     */
    var createPlayer = function (selector, config) {
        //validate selector argument
        if (_.isUndefined(selector) || !_.isString(selector) || _.isEmpty(selector))
        {
            throw new Error("The first argument supplied to create() should be a selector string");
        }

        //validate config argument
        if (_.isEmpty(config) || (!_.isString(config) && !_.isTrueObject(config)))
        {
            throw new Error("The second argument supplied to create() should be either a network acronym or a non-empty object");
        }

        try {
            var player = window.player = {},
                pdkDebug = _.find(debug.getDebugModes(), function (debugMode) {
                    if (_.isEqual(debugMode, 'pdk'))
                    {
                        return true;
                    }
                });

            config = _processAttributes(selector, config);

            window['player'] = config;
            var fdmPlayer = new FDM_Player('player', config.width, config.height);
            player.logLevel= (_.isEqual(pdkDebug, 'pdk')) ? 'debug' : 'none';

            _.each(config, function (prop, key) {
                player[prop] = config[prop];

                if (_.isEqual(key, 'iframePlayerId'))
                {
                    _enableExternalController('meta'); //adds controller to iframe page
                    debug.log('iframeReady dispatching');
                    dispatcher.dispatch('iframeReady', config, true);
                }
            });

            debug.log('PDK logLevel', player.logLevel);
            debug.log('creating player with config', config);
            //TODO: fix the coupling so that you can pass a selector to FDM_Player (or just finally replace the thing)
        }
        catch (error) {
            throw new Error(error);
        }

        return config;
    };

    /**
     * Get an array of all the current players being used
     *
     * @returns {Array} Returns an array of players that have been asked to be created, whether
     * they've been created or not yet
     */
    var getPlayers = function () {
        return _players;
    };

    /**
     * Get's any declarative player attributes (data-player).
     *
     * @param element The element to check for a data-player attribute
     * @returns {{}}
     */
    var getPlayerAttributes = function (selector) {
        var playerAttributes = {},
            elementId;

        var element = document.querySelectorAll(selector);

        //if there are multiple elements from the selector, just use the first one we found
        if (_.isObject(element))
        {
            element = element[0];
        }

        if (_.isDefined(element))
        {
            if (!_.isElement(element))
            {
                throw new Error("What you passed to getPlayerAttributes() wasn't an element. It was likely something " +
                    "like a jQuery object, but try using document.querySelector() or document.querySelectorAll() to get " +
                    "the element that you need. We try to not to depend on jQuery where we don't have to.");
            }

            var allAttributes = element.attributes;

            for (var i = 0, n = allAttributes.length; i < n; i++)
            {
                var attr = allAttributes[i],
                    attrName = attr.nodeName;

                if (attrName === 'data-player')
                {
                    playerAttributes = utils.pipeStringToObject(attr.nodeValue);
                }

                if (attrName === 'id')
                {
                    elementId = attr.nodeValue;
                }
            }

            //if the element supplied has an ID, just use that since it's unique (or at least it should be!)
            if (elementId)
            {
                playerAttributes.id = elementId;
            }
        }
        else
        {
            debug.warn("You called getPlayerAttributes() and whatever you passed (or didn't pass to it) was " +
                "undefined. Thought you should know since it's probably giving you a headache by now :)");
        }

        return playerAttributes;
    };

    /**
     *
     * @param selector
     * @param iframeURL
     * @param suppliedAttributes
     */
    var injectIframePlayer = function (selector, iframeURL, suppliedAttributes) {
        var declaredAttributes = getPlayerAttributes(selector);
        debug.log('declaredAttributes', declaredAttributes);

        var attributes = _processAttributes(selector, suppliedAttributes, declaredAttributes);
        var iframePlayer = new Iframe(selector, iframeURL, attributes);

        iframePlayer.addEventListener('htmlInjected', function (event) {
            debug.log('htmlInjected fired', event);

            var player = {
                controller: null,
                attributes: event.data.attributes,
                element: event.data.element
            };

            if (ovp.isReady())
            {
                var attributes = event.data.attributes;

                //if ovp is already good to go, we can bind now, otherwise we'll bind when ovp:ready fires
                player.controller = ovp.pdk.bind(attributes.iframePlayerId);
                debug.log('binding player', attributes);
                dispatcher.dispatch('playerCreated', attributes);
            }

            debug.log('adding player to _players', player);

            _players.push(player);
        });

        iframePlayer.create();
    };
    //---------------------------------------------- /public methods



    //---------------------------------------------- init
    (function init () {
        debug.log('init');

        ovp.addEventListener('ready', function () {

            debug.log('ovp ready');

            //---------------------------------------- ovp initialize
            if (_.isArray(_players) && !_.isEmpty(_players))
            {
                debug.log('binding players...', _players);

                _.each(_players, function (player) {
                    if (!_.isUndefined(player.controller)) //check for unbound
                    {
                        debug.log('binding controller...');
                        player.controller = ovp.pdk.bind(player.attributes.iframePlayerId);

                        //TODO: remove the try catch (it's just temporary while getting support from thePlatform)
                        try {
                            debug.log('calling ('+player.attributes.iframePlayerId+').onload');
                            //just proving a point that this doesn't work
                            document.getElementById(player.attributes.iframePlayerId).onload();
                        }
                        catch (error) {
                            //error details in diatribe form
                            debug.warn("Calling onload() using getElementById("+ player.attributes.iframePlayerId +") failed...");
                            debug.log("... and just to clarify, that element is there...", document.getElementById(player.attributes.iframePlayerId));
                            debug.log("... and the error is...");
                            window.console.dir(error);

                            //jquery saves the day!
                            debug.log("... but don't worry, jQuery saves the day!");
                            var iframeSelector = '#' + player.attributes.iframePlayerId;
                            jquery(iframeSelector).bind('onload', function () {
                                debug.log('$('+ iframeSelector +').onload(fired!)', arguments);
                            });
                            jquery(iframeSelector).trigger('onload');
                        }

                        dispatcher.dispatch('playerCreated', player.attributes);
                    }
                });

                debug.log('all players bound', _players);
                playback._setController(ovp.controller().controller);
            }
            //---------------------------------------- /ovp initialize
        });
    })();
    //---------------------------------------------- /init



    /**
     * Most of the player's functionality is broken off into submodules, but surfaced here through this one API
     * entry point
     */
    return {
        //public api
        setPlayerMessage: setPlayerMessage,
        clearPlayerMessage: clearPlayerMessage,
        createIframe: injectIframePlayer,
        injectIframePlayer: injectIframePlayer, //old alias (will deprecate eventually)
        hide: ovp.hide,
        show: ovp.show,
        getCurrentVideo: getCurrentVideo,
        getMostRecentAd: getMostRecentAd,
        loadVideo: loadVideo,
        getPosition: getCurrentPosition,
        create: createPlayer,
        getPlayers: getPlayers,

        //control methods
        control: control,
        getController: getController,
        seekTo: playback.seekTo,
        play: playback.play,
        pause: playback.pause,

        //event listening
        addEventListener: dispatcher.addEventListener,
        getEventListeners: dispatcher.getEventListeners,
        hasEventListener: dispatcher.hasEventListener,
        removeEventListener: dispatcher.removeEventListener,

        //testing-only api (still public, but please DO NOT USE unless unit testing)
        __test__: {
            _processAttributes: _processAttributes,
            ovp: ovp
        }
    };
});