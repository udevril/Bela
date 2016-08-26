'use strict';
var dgram = require('dgram');
var scopeOSC = require('./scope-osc');

var scopeConnected = false;
var settings = {
	connected		: {type: 'integer', value: 0},
	numChannels		: {type: 'integer', value: 2},
	sampleRate		: {type: 'float', value: 44100},
	frameWidth		: {type: 'integer', value: 1280},
	plotMode		: {type: 'integer', value: 0},
	triggerMode		: {type: 'integer', value: 0},
	triggerChannel	: {type: 'integer', value: 0},
	triggerDir		: {type: 'integer', value: 0},
	triggerLevel	: {type: 'float', value: 0},
	xOffset			: {type: 'integer', value: 0},
	upSampling		: {type: 'integer', value: 1},
	downSampling	: {type: 'integer', value: 1},
	FFTLength		: {type: 'integer', value: 1024},
	FFTXAxis		: {type: 'integer', value: 0},
	FFTYAxis		: {type: 'integer', value: 0},
	holdOff			: {type: 'float', value: 20},
	numSliders		: {type: 'integer', value:0},
	interpolation	: {type: 'integer', value:0}
}

var UDP_RECIEVE = 8677;

var bufferReceived = true;
var droppedcount = 0;

var sliderArgs = [];

var scope = {
	
	init(io){	
		
		// setup the websockets
		this.webSocket = io.of('/BelaScope');
		this.workerSocket = io.of('/BelaScopeWorker');
		
		this.webSocket.on('connection', (socket) => this.browserConnected(socket) );
		this.workerSocket.on('connection', (socket) => this.workerConnected(socket) );
		
		// setup the OSC server
		scopeOSC.init();
		scopeOSC.on('scope-setup', args => this.scopeConnected(args) );
		scopeOSC.on('scope-slider', args => this.scopeSlider(args) );
		
		// UDP socket to receive raw scope data from bela scope
		var scopeUDP = dgram.createSocket('udp4');
		scopeUDP.bind(UDP_RECIEVE, '127.0.0.1');

		// echo raw scope data over websocket to browser
		scopeUDP.on('message', (buffer) => {
			//console.log('raw scope buffer recieved, of length', buffer.length);
			if (!bufferReceived){
				//console.log('frame dropped');
				droppedcount += 1;
				return;
			}
			bufferReceived = false;
			this.workerSocket.emit('buffer', buffer);
		});
		
		setInterval( () => {
			if(scopeConnected && settings.connected.value) this.webSocket.emit('dropped-count', droppedcount);
			droppedcount = 0;
		}, 1000);
		
	},
	
	scopeConnected(args){
		
		if (args[0].type === 'integer' && args[1].type === 'float' && args[2].type === 'integer'){
			settings.numChannels = args[0];
			settings.sampleRate = args[1];
			settings.numSliders = args[2];
		} else {
			console.log('bad setup message args', args);
			return;
		}
		
		console.log('scope connected');
		scopeConnected = true;
		sliderArgs = [];
		
		this.webSocket.emit('settings', settings);
		
		scopeOSC.sendSetupReply(settings);
			
	},
	
	scopeSlider(args){
	
		this.webSocket.emit('scope-slider', args);
		sliderArgs.push(args);

	},
	
	browserConnected(socket){
		console.log('scope browser connected');
		
		// send the settings to the browser
		socket.emit('settings', settings);
		
		if (sliderArgs.length){
			for (let item of sliderArgs){
				this.webSocket.emit('scope-slider', item);
			}
		}
		
		// tell the scope that the browser is connected
		settings.connected.value = 1;
		if (scopeConnected)
			scopeOSC.sendSetting('connected', settings.connected);
			
		socket.on('disconnect', () => {
			console.log('scope browser disconnected');
			// tell the scope that the browser is connected
			settings.connected.value = 0;
			if (scopeConnected)
				scopeOSC.sendSetting('connected', settings.connected);
		});
		
		socket.on('settings-event', (key, value) => {
			if (settings[key]){
				if (key === 'upSampling' || key === 'downSampling' || key === 'plotMode') {
					this[key](value);
					return;
				}
				if (settings[key].type === 'integer') value = parseInt(value);
				else if (settings[key].type === 'float') value = parseFloat(value);
				settings[key].value = value;
				if (scopeConnected)
					scopeOSC.sendSetting(key, settings[key]);
			} else {
				console.log('bad settings-event', key, value);
			}
		});
		
		socket.on('slider-value', (slider, value) => scopeOSC.sendSliderValue(slider, value) );
		
	},
	
	upSampling(){
		if (settings.downSampling.value > 1){
			settings.downSampling.value -= 1;
			this.webSocket.emit('settings', {downSampling: settings.downSampling});
			if (scopeConnected)
				scopeOSC.sendSetting('downSampling', settings['downSampling']);
		} else if (settings.plotMode.value !== 1) {
			settings.upSampling.value += 1;
			this.webSocket.emit('settings', {upSampling: settings.upSampling});
			if (scopeConnected)
				scopeOSC.sendSetting('upSampling', settings['upSampling']);
		}
	},
	downSampling(){
		if (settings.upSampling.value > 1){
			settings.upSampling.value -= 1;
			this.webSocket.emit('settings', {upSampling: settings.upSampling});
			if (scopeConnected)
				scopeOSC.sendSetting('upSampling', settings['upSampling']);
		} else {
			settings.downSampling.value += 1;
			this.webSocket.emit('settings', {downSampling: settings.downSampling});
			if (scopeConnected)
				scopeOSC.sendSetting('downSampling', settings['downSampling']);
		}
	},
	
	plotMode(value){
		settings.plotMode.value = parseInt(value);
		settings.upSampling.value = 1;
		settings.downSampling.value = 1;
		if (scopeConnected){
			scopeOSC.sendSetting('upSampling', settings['upSampling']);
			scopeOSC.sendSetting('downSampling', settings['downSampling']);
			scopeOSC.sendSetting('plotMode', settings['plotMode']);
		}
		this.webSocket.emit('settings', {upSampling: settings.upSampling, downSampling: settings.downSampling});
	},
	
	workerConnected(socket){
	
		socket.emit('ready');
		
		socket.on('buffer-received', () => {
			bufferReceived = true;
		});
	}
	
};

module.exports = scope;