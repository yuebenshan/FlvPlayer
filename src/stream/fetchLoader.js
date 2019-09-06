import { mergeBuffer, throttle, calculationRate } from '../utils';
import { checkReadableStream } from '../utils/isSupported';

export default class FetchLoader {
    constructor(flv) {
        this.flv = flv;
        this.byteLength = 0;
        this.reader = null;
        this.chunkStart = 0;
        this.contentLength = 0;
        this.data = new Uint8Array();
        this.readChunk = throttle(this.readChunk, 1000);

        this.streamRate = calculationRate(rate => {
            flv.emit('streamRate', rate);
        });

        flv.on('destroy', () => {
            this.reader.cancel();
            this.data = null;
        });

        flv.on('timeupdate', currentTime => {
            if (!flv.options.live && flv.player.loaded - currentTime <= 5) {
                this.readChunk();
            }
        });

        if (checkReadableStream()) {
            this.initFetchStream();
        } else {
            this.initFetchRange(0, flv.options.chunkSize);
        }
    }

    readChunk() {
        const { options } = this.flv;
        const chunkEnd = Math.min(this.chunkStart + options.chunkSize, this.data.length);
        if (chunkEnd > this.chunkStart) {
            const chunkData = this.data.subarray(this.chunkStart, chunkEnd);
            this.flv.emit('streaming', chunkData);
            this.chunkStart = chunkEnd;
        }
    }

    initFetchStream() {
        const { options, debug } = this.flv;
        const self = this;
        this.flv.emit('streamStart');
        return fetch(options.url, {
            headers: options.headers,
        })
            .then(response => {
                self.reader = response.body.getReader();
                return (function read() {
                    return self.reader
                        .read()
                        .then(({ done, value }) => {
                            if (done) {
                                self.flv.emit('streamEnd');
                                debug.log('stream-end', `${self.byteLength} byte`);
                                return;
                            }

                            const uint8 = new Uint8Array(value);
                            self.byteLength += uint8.byteLength;
                            self.streamRate(uint8.byteLength);

                            if (options.live) {
                                self.flv.emit('streaming', uint8);
                            } else {
                                self.data = mergeBuffer(self.data, uint8);
                                if (self.chunkStart === 0) {
                                    self.readChunk();
                                }
                            }

                            // eslint-disable-next-line consistent-return
                            return read();
                        })
                        .catch(error => {
                            self.flv.emit('streamError', error);
                            throw error;
                        });
                })();
            })
            .catch(error => {
                self.flv.emit('streamError', error);
                throw error;
            });
    }

    initFetchRange(rangeStart, rangeEnd) {
        console.log(0);
        const { options, debug } = this.flv;
        const self = this;
        this.flv.emit('streamStart');
        return fetch(options.url, {
            mode: 'no-cors',
            headers: {
                ...options.headers,
                range: `bytes=${rangeStart}-${rangeEnd}`,
            },
        })
            .then(response => {
                console.log(1);
                self.contentLength = Number(response.headers.get('content-length')) || options.filesize;
                debug.error(
                    self.contentLength,
                    `Unable to get response header 'content-length' or custom options 'filesize'`,
                );
                console.log(2);
                return response.arrayBuffer();
            })
            .then(value => {
                console.log(3);
                if (value.byteLength === rangeEnd - rangeStart) {
                    console.log(4);
                    const uint8 = new Uint8Array(value);
                    self.byteLength += uint8.byteLength;
                    self.streamRate(uint8.byteLength);

                    if (options.live) {
                        console.log(5);
                        self.flv.emit('streaming', uint8);
                    } else {
                        console.log(6);
                        self.data = mergeBuffer(self.data, uint8);
                        if (self.chunkStart === 0) {
                            self.readChunk();
                        }
                    }

                    console.log(7);
                    const nextRangeStart = Math.min(self.contentLength, rangeEnd + 1);
                    const nextRangeEnd = Math.min(self.contentLength, nextRangeStart.rangeStart + options.chunkSize);
                    if (nextRangeEnd > nextRangeStart) {
                        console.log(8);
                        self.initFetchRange(nextRangeStart, nextRangeEnd);
                    }
                } else {
                    console.log(9);
                    debug.error(
                        false,
                        `Unable to get correct segmentation data: ${JSON.stringify({
                            contentLength: self.contentLength,
                            byteLength: value.byteLength,
                            rangeStart,
                            rangeEnd,
                        })}`,
                    );
                }
            })
            .catch(error => {
                self.flv.emit('streamError', error);
                throw error;
            });
    }
}
