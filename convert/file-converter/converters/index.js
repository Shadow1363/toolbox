/**
 * Registers every converter. To add a format: add it to ../formats.js, write a module that
 * default-exports an array of converters (see ../registry.js for the shape), import it here.
 * Order matters only as a tie-breaker when two chains are equally short.
 */
import { register } from '../registry.js';
import markdown from './markdown.js';
import html from './html.js';
import docx from './docx.js';
import pdf from './pdf.js';
import text from './text.js';
import data from './data.js';
import images from './images.js';
import media from './media.js';

register(markdown, html, docx, pdf, text, data, images, media);
