import env from "dotenv";
import axios from "axios";
import dayjs from "dayjs";
import colors from "colors";
import mongoose from "mongoose";
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { DiscordAPIError, WebhookClient } from "discord.js";

env.config()
dayjs.extend(utc)
dayjs.extend(timezone)

/* = = = = = DISCORD SETUP = = = = = */

const Discord = require("discord.js");
const client = new Discord.Client();
client.login(process.env.TOKEN)
client.prefix = ",";
let testHook = new Discord.WebhookClient(process.env.testHookID, process.env.testHookToken) /* My Test Server */ 
let clerbHook = new Discord.WebhookClient(process.env.clerbHookID, process.env.clerbHookToken) /* My Test Server */ 
let aylinHook = new Discord.WebhookClient(process.env.aylinHookID, process.env.aylinHookToken) /* My Test Server */ 

/* = = = = = Mongoose SETUP = = = = = */

mongoose.connect(`mongodb://${process.env.MongoUser}:${process.env.MongoPass}@localhost:27017/${process.env.MongoDB}?authSource=PJSDB`, {
    useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true,
}, (err: Error) => {
    if (err) console.log(err);
})

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const MedalTVSchema = new Schema({
    author: ObjectId,
    // unique ids
    streamer: String,

    // updated per video
    video: String,// latest video's unique id
    date: Number, // latest video creation date
    count: Number // total clips on medal tv profile
});

const MedalTVModel = mongoose.model("MedalTV", MedalTVSchema);

/* = = = = = MedalTV SETUP = = = = = */

const streamers = new Map();
streamers.set("EmperorSR", { id: 6240449, servers: [testHook] })

// 2am Clerb
streamers.set("Saabpar", { id: 3659873, servers: [clerbHook] })
streamers.set("reretheassassin", { id: 10321309, servers: [clerbHook] })
streamers.set("cero117", { id: 5859858, servers: [clerbHook] })
streamers.set("whiskerskittle", { id: 9143116, servers: [clerbHook] })
streamers.set("EraSAABle", { id: 6424930, servers: [clerbHook] })
streamers.set("BackwoodRaider", { id: 7491349, servers: [clerbHook] })

// Aylin

/* = = = = = MAIN START = = = = = */

client.on("ready", async () => {
    console.log(`[MedalTV] ${client.user.tag} is now online!`);
    
    let updater: any = setInterval(function() {
        console.log(colors.red(`Running update . . . ${dayjs().tz("America/New_York").format('MM/DD/YYYY hh:mm:ssa')} EST`));
        
        streamers.forEach((data) => {
            
            let {id, servers} = data;
            console.log(colors.yellow(`᲼᲼[${id}] Updating . . .`));
            fetchLastVideoByUser(id, servers)
        })

    }, 6e4 /* 60,000 ms / 1 minute */) 

    process.on("SIGINT", () => {
        clearInterval(updater)
        process.exit()
    })

})

// client.on("message", (msg: any) => {
//     if (msg.author.bot || (msg.content.startsWith(client.prefix) && msg.content.charAt(msg.content.length - 1) == client.prefix)) return;

//     //Setup prefix
//     let prefixes = [client.prefix, `<@${client.user.id}> `, `<@!${client.user.id}> `];
//     for (let thisPrefix of prefixes) if (msg.content.startsWith(thisPrefix)) client.prefix = thisPrefix;
//     if(msg.content.indexOf(client.prefix) !== 0) return;
    
//     //Load Args, cmd
//     const args = msg.content.slice(client.prefix.length).trim().split(/ +/g);
//     const command = args.shift().toLowerCase();

//     switch (command) {
//         case "ping": msg.channel.send("Medal TV Script online c:"); break;
//         default: break;
//     }

//     return;
// })
/* = = = = = END OF MAIN  = = = = = */



/* = = = = = Function Types = = = = = */

type videoObject = {
    contentId: string,
    contentTitle: string,
    contentThumbnail: string,
    videoLengthSeconds: Number,
    createdTimestamp: Date,
    directClipUrl: string,
    credits: string,
}

type dbObject = { 
    streamer: String | undefined, 
    video: String | undefined
}

/* = = = = = Functions = = = = = */

const fetchLastVideoByUser = function (userid: string, servers: Array<WebhookClient>): void {
        
    let url = `https://developers.medal.tv/v1/latest?userId=${userid}`;
    let options = { headers: {"Authorization" : "x"} };

    axios.get(url, options).then(async(res) => {
        // console.log(colors.green(`᲼᲼᲼᲼[${userid}]AXIOS`), colors.yellow(userid));
        let content = res.data.contentObjects;
        
        if (content.length) findUserWithinDB(userid, content, servers)
        else return console.log(`᲼᲼᲼᲼[${userid}]User ${userid} has no clips set to public!`)
    })
}

const findUserWithinDB = (userid: String, content: Array<videoObject>,  servers: Array<WebhookClient>): void => {
    MedalTVModel.findOne({"streamer": `${userid}`}, (err, res: any) => {
        if (err) throw err;

        if (res) {
            let latest = content[0];

             // user deleted/unlisted some videos
             if (res.count > content.length) {
                console.log(`᲼᲼᲼᲼[${userid}]Vids deleted by user, updating db.`);

                // update count in db to current
                MedalTVModel.updateOne({streamer: userid}, {count: content.length}, (err, res) => {
                    if (err) throw err;
                    return console.log(`᲼᲼᲼᲼[${userid}]Updated counts in db.`);
                })
            }

            // if more videos are found in medal, send new vids
            else if ( (res.count < content.length) || (
                // or if same vid length, but latest is newer than db's record, send new vid
                (res.count == content.length) && (res.date < latest.createdTimestamp)// || latest.contentId != res.video)
            ) ) {
                
                let vidCount = content.length - parseInt(res.count);
                let newVids = content.slice(0, vidCount == 0 ? 1 : vidCount);
                
                console.log(`᲼᲼᲼᲼[${userid}]New vids detected: ${vidCount}`);

                updateRecord(userid, vidCount ? newVids : [newVids[0]], servers, content.length, "update")
    } //else console.log(`᲼᲼᲼᲼[${userid}]Repeated or Deleted content, ending.`);
           
        } else updateRecord(userid, [content[0]], servers, content.length, "insert")
    })
}

const updateRecord = (userid: String, newVids: Array<videoObject>, servers: Array<WebhookClient>, totalClipsCount: Number, method: String) => {
    let data = newVids[0];
    if (method == "insert") {
        console.log(`᲼᲼᲼᲼[${userid}]Inserting new user.`);
        let { contentId, createdTimestamp } = data;
        new MedalTVModel({ 
            streamer: userid,
            video: contentId,
            date: createdTimestamp,
            count: totalClipsCount
        }).save((err, res) => { if (err) return console.error(err) })
    }
    else if (method == "update") {
        console.log(`᲼᲼᲼᲼[${userid}]Updating db user.`);


        MedalTVModel.updateOne({streamer: userid}, {
            video: data.contentId,
            date: data.createdTimestamp,
            count: totalClipsCount
        }, (res:any): void => {
            console.log(`᲼᲼᲼᲼[${userid}]update RES: `, res);
        })
    }

    generateEmbeds(userid, newVids, servers)
}

const generateEmbeds = (userid: String, newVids: Array<videoObject>, servers: Array<WebhookClient>) => {
    /*
        
        let { contentId, contentTitle, contentThumbnail, videoLengthSeconds, createdTimestamp, directClipUrl, credits} = input;
        let embed = new Discord.MessageEmbed();
        
        embed.setDescription(`[Duration: ${videoLengthSeconds}s] [[Video](${directClipUrl})] [[Profile](https://medal.tv/users/${userid})] [${contentId}]
            Created: ${dayjs(createdTimestamp).tz("America/Los_Angeles").format('MM/DD/YYYY hh:mm:ssa') } PST`)

        embed.setTitle(contentTitle)
        embed.setThumbnail(contentThumbnail)
        embed.setURL(directClipUrl)
        embed.setFooter(`${credits}`)

        console.log(colors.yellow(`[${userid}] Sending Embeds . . .`));

    */
   servers.every((hook: WebhookClient) => hook.send(`${newVids.map(x => x.directClipUrl).join("\n")}`))

}
