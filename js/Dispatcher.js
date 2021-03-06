/*global define, _ */

define([
    'lodash',
    'jquery-loader',
    'base64',
    'require'
], function (_, jquery, base64, require) {
    'use strict';

    var ieEvents = ['onblur', 'onchange', 'onclick', 'oncontextmenu', 'oncopy',
        'oncut', 'ondblclick', 'onerror', 'onfocus', 'onfocusin', 'onfocusout',
        'onhashchange', 'onkeydown', 'onkeypress',' onkeyup', 'onload', 'onmousedown',
        'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover',
        'onmouseup', 'onmousewheel', 'onpaste', 'onreset', 'onresize', 'onscroll',
        'onselect', 'onsubmit', 'onunload'];

    var _listeners = [],
        //gets setup in init
        debug,
        storage;

    return function (owningModuleName) {

        //////////////////////////////////////////////// private methods...
        ////////////////////////////////////////////////



        //////////////////////////////////////////////// public methods...
        var addListener = function (eventName, callback) {
            if (_.isEmpty(eventName) || !_.isString(eventName))
            {
                return false;
            }

//            if (!_.isFunction(callback))
//            {
//                throw new Error("You can't create an event listener without supplying a callback function");
//            }

            var deferred = new jquery.Deferred();
            var listener = {
                name: eventName,
                callback: callback,
                deferred: deferred
            };

            _listeners.push(listener);

            return deferred;
        };

        var dispatch = function (eventName, data, dispatchOverWindow) {
            if (_.isEmpty(eventName) || !_.isString(eventName))
            {
                throw new Error("You can't dispatch an event without supplying an event name (as a string)");
            }

            var name = '@@packageName:' + eventName;
            var evt;

            if (window.dispatchEvent) {
                evt = document.createEvent('Event');
                evt.initEvent(name, true, true);
            } else {
                evt = window.jQuery.Event(name);
            }
            evt.data = data || null;

            if (!dispatchOverWindow)
            {
                var listeners = _.where(_listeners, {name: eventName});

                _.each(listeners, function (listener) {
                    listener.deferred.resolveWith(listener, evt);
                    listener.callback(evt);
                });
            }
            else
            {
                if (window.dispatchEvent) {
                    window.dispatchEvent(evt);
                } else {
                    debug.log('Dispatching ' + name + ' over window with jQuery');
                    window.jQuery(window).trigger(name, evt);
                }
            }
            return true;
        };

        var getEventListeners = function (eventName) {

            if (_.isUndefined(eventName))
            {
                return _listeners;
            }

            var found = [];

            _.each(_listeners, function (listener) {
                if (listener.name === eventName)
                {
                    found.push(listener);
                }
            });

            return found;
        };

        var hasListener = function (eventName, callback) {
            var found = false,
                checkCallbackToo = false;

            if (!_.isEmpty(eventName) && _.isString(eventName))
            {
                if (!_.isUndefined(callback) && _.isFunction(callback))
                {
                    checkCallbackToo = true;
                }

                _.each(_listeners, function (listener) {
                    if (listener.name === eventName)
                    {
                        if (checkCallbackToo)
                        {
                            if (listener.callback.toString() === callback.toString())
                            {
                                found = true;
                            }
                        }
                        else
                        {
                            found = true;
                        }
                    }
                });
            }

            return found;
        };

        var removeListener = function (eventName, callback) {
            if (_.isUndefined(eventName) || !_.isString(eventName))
            {
                throw new Error("The first argument supplied to removeEventListener() should be a string for the event name");
            }

            if (_.isUndefined(callback) || !_.isFunction(callback))
            {
                throw new Error("The second argument supplied to removeEventListener() should be a function for the callback that was used");
            }

            var updated = [],
                removed = false;

            _.each(_listeners, function (listener) {
                if (listener.name !== eventName && _.isFunction(_listeners.callback) && _listeners.callback.toString() !== callback.toString())
                {
                    updated.push(listener);
                }
                else
                {
                    removed = true;
                }
            });

            _listeners = updated;

            return removed;
        };

        var removeAllListeners = function () {
            _listeners = [];

            return _listeners;
        };

        var up = function (message, data) {
            if (storage.now.get('insideIframe'))
            {
                var payload = {
                    eventName: message,
                    data: (!_.isUndefined(data) && !_.isEmpty(data)) ? data : null,
                    owningModuleName: owningModuleName || null
                };

                var encoded = '@@packageName:' + base64.encode(payload);
                window.parent.postMessage(encoded, '*');
            }
        };
        ////////////////////////////////////////////////

//        var delivered = function (messageName) {
//            var deferred = new jquery.Deferred();
//
//            _.each(_messages, function (message) {
//                if ('@@packageName:' + messageName === message.eventName)
//                {
//                    deferred.resolve(message.payload);
//                }
//            });
//
//            return deferred;
//        };

        //////////////////////////////////////////////// initialize...
        (function init () {
            storage = require('storage');
            var Debug = require('Debug');
            var listen = window.addEventListener || window.attachEvent;
            debug = new Debug(owningModuleName + '(dispatcher)');

            listen('message', function (event) {

                if (event.data.indexOf('@@packageName:') !== -1)
                {
                    //split the postMessage string
                    var encoded = event.data.split('@@packageName:')[1];
                    if (!_.isString(encoded) || _.isEmpty(encoded))
                    {
                        throw new Error("Splitting the encoded postMessage failed: please contact the developer");
                    }

                    //decode the base64 string
                    var decoded = base64.decode(encoded);
                    if (!_.isTrueObject(decoded) || _.isEmpty(decoded))
                    {
                        throw new Error("The decoded postMessage was either not an object or empty: please contact the developer");
                    }

                    if (owningModuleName === decoded.owningModuleName)
                    {
                        dispatch(decoded.eventName, decoded.data);
                    }
                }
            });
        })();
        ////////////////////////////////////////////////



        //////////////////////////////////////////////// public api...
        return {
            on: addListener,
            dispatch: dispatch,
            dispatchOverWindow: function (eventName, data) {
                dispatch(eventName, data);
            },
            getEventListeners: getEventListeners,
            hasEventListener: hasListener,
            removeEventListener: removeListener,
            removeAllEventListeners: removeAllListeners,

            //postMessage methods
            up: up
        };
        ////////////////////////////////////////////////
    };
});